import AppKit
import Foundation

private struct MenuBarConfig: Decodable {
    let nodePath: String
    let cliPath: String
    let adminUrl: String
    let appHome: String
    let logPath: String
    let appPath: String
    let launchAgentPath: String
    let version: String
}

@main
private enum Main {
    static func main() {
        let application = NSApplication.shared
        let delegate = MenuBarApp()
        application.delegate = delegate
        application.run()
    }
}

final class MenuBarApp: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var statusMenuItem: NSMenuItem!
    private var startMenuItem: NSMenuItem!
    private var stopMenuItem: NSMenuItem!
    private var launchAtLoginMenuItem: NSMenuItem!
    private var adminProcess: Process?
    private var logHandle: FileHandle?
    private var timer: Timer?
    private var adminReachable = false
    private lazy var config: MenuBarConfig = loadConfig()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        buildMenu()
        refreshStatus()
        timer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in
            self?.refreshStatus()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        if let process = adminProcess, process.isRunning {
            process.terminate()
        }
        try? logHandle?.close()
    }

    private func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: 32)
        if let button = statusItem.button {
            button.image = nil
            button.title = "1P"
            button.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .semibold)
            button.toolTip = "1Password Agent MCP"
        }

        let menu = NSMenu()
        let title = NSMenuItem(title: "1Password Agent MCP", action: nil, keyEquivalent: "")
        title.isEnabled = false
        menu.addItem(title)

        statusMenuItem = NSMenuItem(title: "Checking admin console...", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        menu.addItem(.separator())

        let openItem = NSMenuItem(title: "Open Admin Console", action: #selector(openAdmin), keyEquivalent: "o")
        openItem.target = self
        menu.addItem(openItem)

        startMenuItem = NSMenuItem(title: "Start Admin Console", action: #selector(startAdmin), keyEquivalent: "")
        startMenuItem.target = self
        menu.addItem(startMenuItem)

        stopMenuItem = NSMenuItem(title: "Stop Admin Console", action: #selector(stopAdmin), keyEquivalent: "")
        stopMenuItem.target = self
        menu.addItem(stopMenuItem)
        menu.addItem(.separator())

        launchAtLoginMenuItem = NSMenuItem(title: "Launch Menu Bar at Login", action: #selector(toggleLaunchAtLogin), keyEquivalent: "")
        launchAtLoginMenuItem.target = self
        menu.addItem(launchAtLoginMenuItem)

        let removeItem = NSMenuItem(title: "Remove Menu Bar Shortcut...", action: #selector(removeShortcut), keyEquivalent: "")
        removeItem.target = self
        menu.addItem(removeItem)

        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "Quit Menu Bar", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
        statusItem.menu = menu
        updateLaunchAtLoginState()
    }

    @objc private func openAdmin() {
        checkAdmin { [weak self] reachable in
            guard let self else { return }
            if reachable {
                self.openAdminURL()
            } else {
                self.startAdminProcess(openWhenReady: true)
            }
        }
    }

    @objc private func startAdmin() {
        checkAdmin { [weak self] reachable in
            guard let self else { return }
            if !reachable {
                self.startAdminProcess(openWhenReady: false)
            }
        }
    }

    @objc private func stopAdmin() {
        guard let process = adminProcess, process.isRunning else { return }
        process.terminate()
        statusMenuItem.title = "Stopping admin console..."
    }

    @objc private func toggleLaunchAtLogin() {
        let enable = launchAtLoginMenuItem.state != .on
        let exitCode = runCli(["menubar", "login", enable ? "on" : "off"], wait: true)
        if exitCode != 0 {
            showError("Could not change the login setting. Run onepassword-agent-mcp menubar status in Terminal for details.")
        }
        updateLaunchAtLoginState()
    }

    @objc private func removeShortcut() {
        let alert = NSAlert()
        alert.messageText = "Remove the menu-bar shortcut?"
        alert.informativeText = "This removes only the visible shortcut and its login item. Your MCP setup, approvals, MCPVAULT, and 1Password items stay untouched."
        alert.addButton(withTitle: "Remove Shortcut")
        alert.addButton(withTitle: "Cancel")
        alert.alertStyle = .warning
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        _ = runCli(["menubar", "uninstall", "--apply"], wait: false)
        NSApp.terminate(nil)
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    private func startAdminProcess(openWhenReady: Bool) {
        if let process = adminProcess, process.isRunning {
            if openWhenReady { pollUntilReady(attempt: 0) }
            return
        }

        FileManager.default.createFile(atPath: config.logPath, contents: nil)
        logHandle = FileHandle(forWritingAtPath: config.logPath)
        if let logHandle { _ = try? logHandle.seekToEnd() }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: config.nodePath)
        process.arguments = [config.cliPath, "admin"]
        var environment = ProcessInfo.processInfo.environment
        environment["ONEPASSWORD_MCP_HOME"] = config.appHome
        environment["ONEPASSWORD_MCP_MENUBAR_APP"] = config.appPath
        environment["ONEPASSWORD_MCP_MENUBAR_LAUNCH_AGENT"] = config.launchAgentPath
        process.environment = environment
        process.standardOutput = logHandle
        process.standardError = logHandle
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.adminProcess = nil
                self?.refreshStatus()
            }
        }

        do {
            try process.run()
            adminProcess = process
            statusMenuItem.title = "Admin console starting..."
            if openWhenReady { pollUntilReady(attempt: 0) }
        } catch {
            showError("Could not start the admin console. \(error.localizedDescription)")
        }
    }

    private func pollUntilReady(attempt: Int) {
        checkAdmin { [weak self] reachable in
            guard let self else { return }
            if reachable {
                self.openAdminURL()
            } else if attempt < 8 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    self.pollUntilReady(attempt: attempt + 1)
                }
            } else {
                self.showError("The admin console did not start. See \(self.config.logPath) for details.")
            }
        }
    }

    private func refreshStatus() {
        checkAdmin { _ in }
        updateLaunchAtLoginState()
    }

    private func checkAdmin(completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: "\(config.adminUrl)/api/status") else {
            completion(false)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.2
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            let reachable = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                guard let self else { return }
                self.adminReachable = reachable
                let owned = self.adminProcess?.isRunning == true
                self.statusMenuItem.title = reachable
                    ? owned ? "Admin console running" : "Admin console running separately"
                    : "Admin console stopped"
                self.startMenuItem.isEnabled = !reachable
                self.stopMenuItem.isEnabled = reachable && owned
                completion(reachable)
            }
        }.resume()
    }

    private func openAdminURL() {
        guard let url = URL(string: config.adminUrl) else { return }
        NSWorkspace.shared.open(url)
    }

    private func updateLaunchAtLoginState() {
        launchAtLoginMenuItem.state = FileManager.default.fileExists(atPath: config.launchAgentPath) ? .on : .off
    }

    @discardableResult
    private func runCli(_ arguments: [String], wait: Bool) -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: config.nodePath)
        process.arguments = [config.cliPath] + arguments
        var environment = ProcessInfo.processInfo.environment
        environment["ONEPASSWORD_MCP_HOME"] = config.appHome
        environment["ONEPASSWORD_MCP_MENUBAR_APP"] = config.appPath
        environment["ONEPASSWORD_MCP_MENUBAR_LAUNCH_AGENT"] = config.launchAgentPath
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            if wait {
                process.waitUntilExit()
                return process.terminationStatus
            }
            return 0
        } catch {
            return 1
        }
    }

    private func showError(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "1Password Agent MCP"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    private func loadConfig() -> MenuBarConfig {
        guard let url = Bundle.main.url(forResource: "menu-bar", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let config = try? JSONDecoder().decode(MenuBarConfig.self, from: data) else {
            fatalError("The menu-bar configuration is missing.")
        }
        return config
    }
}
