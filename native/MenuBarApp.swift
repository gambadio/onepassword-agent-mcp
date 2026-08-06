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
        menu.autoenablesItems = false
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

        stopMenuItem = NSMenuItem(title: "Stop Admin Console", action: #selector(stopAdmin), keyEquivalent: "")
        stopMenuItem.target = self
        menu.addItem(stopMenuItem)
        menu.addItem(.separator())

        launchAtLoginMenuItem = NSMenuItem(title: "Launch Menu Bar at Login", action: #selector(toggleLaunchAtLogin), keyEquivalent: "")
        launchAtLoginMenuItem.target = self
        menu.addItem(launchAtLoginMenuItem)

        let removeItem = NSMenuItem(title: "Remove From Menu Bar", action: #selector(removeFromMenuBar), keyEquivalent: "")
        removeItem.target = self
        menu.addItem(removeItem)

        let uninstallItem = NSMenuItem(title: "Uninstall Menu Bar Shortcut...", action: #selector(uninstallShortcut), keyEquivalent: "")
        uninstallItem.target = self
        menu.addItem(uninstallItem)
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

    @objc private func stopAdmin() {
        statusMenuItem.title = "Stopping admin console..."
        stopMenuItem.isEnabled = false
        if let process = adminProcess, process.isRunning {
            process.terminate()
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let exitCode = self.runCli(["admin", "stop"], wait: true)
            DispatchQueue.main.async {
                if exitCode != 0 {
                    self.showError("Could not stop the admin console. Run onepassword-agent-mcp admin stop in Terminal for details.")
                }
                self.refreshStatus()
            }
        }
    }

    @objc private func toggleLaunchAtLogin() {
        let enable = launchAtLoginMenuItem.state != .on
        let exitCode = runCli(["menubar", "login", enable ? "on" : "off"], wait: true)
        if exitCode != 0 {
            showError("Could not change the login setting. Run onepassword-agent-mcp menubar status in Terminal for details.")
        }
        updateLaunchAtLoginState()
    }

    @objc private func removeFromMenuBar() {
        NSApp.terminate(nil)
    }

    @objc private func uninstallShortcut() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.confirmUninstallShortcut()
        }
    }

    private func confirmUninstallShortcut() {
        let alert = NSAlert()
        alert.messageText = "Uninstall the menu-bar shortcut?"
        alert.informativeText = "This removes the installed menu helper and its login item. Your MCP setup, approvals, MCPVAULT, and 1Password items stay untouched. To install it again later, run onepassword-agent-mcp menubar install in Terminal or enable it in the admin page."
        let uninstallButton = alert.addButton(withTitle: "Uninstall Shortcut")
        uninstallButton.hasDestructiveAction = true
        uninstallButton.keyEquivalent = ""
        let cancelButton = alert.addButton(withTitle: "Cancel")
        cancelButton.keyEquivalent = "\u{1b}"
        alert.alertStyle = .warning
        if let cancelCell = cancelButton.cell as? NSButtonCell {
            alert.window.defaultButtonCell = cancelCell
        }
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        _ = runCli(["menubar", "uninstall", "--apply"], wait: false)
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
        guard let url = URL(string: "\(config.adminUrl)/api/health") else {
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
                self.statusMenuItem.title = reachable ? "Admin console running" : "Admin console stopped"
                self.stopMenuItem.isEnabled = reachable
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
