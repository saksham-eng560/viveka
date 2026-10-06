// Lighthouse Buddy: Sheru on your desktop.
//
// A transparent, always-on-top panel (top-left of the screen) that hosts the Sheru web UI
// served by the Lighthouse backend, plus the desktop sensors the coach needs:
//   * frontmost app + window title (window title needs Accessibility permission)
//   * seconds since the last key press / any input (system counters; no key logging)
//   * screen lock state
// Build: buddy/build.sh   Run: "buddy/build/Lighthouse Buddy.app/Contents/MacOS/LighthouseBuddy" --port 8000

import AppKit
import ApplicationServices
import WebKit

// MARK: - configuration

struct Config {
    var port = 8000
    var dashboard = "http://localhost:3000"

    static func fromArgs() -> Config {
        var c = Config()
        let args = CommandLine.arguments
        var i = 1
        while i < args.count {
            switch args[i] {
            case "--port": if i + 1 < args.count, let p = Int(args[i + 1]) { c.port = p; i += 1 }
            case "--dashboard": if i + 1 < args.count { c.dashboard = args[i + 1]; i += 1 }
            default: break
            }
            i += 1
        }
        if let env = ProcessInfo.processInfo.environment["BACKEND_PORT"], let p = Int(env) { c.port = p }
        return c
    }

    var base: String { "http://127.0.0.1:\(port)" }
    var pageURL: URL {
        var comps = URLComponents(string: "\(base)/buddy/")!
        comps.queryItems = [URLQueryItem(name: "native", value: "1"), URLQueryItem(name: "dash", value: dashboard)]
        return comps.url!
    }
}

let windowSize = NSSize(width: 460, height: 320)

// MARK: - panel

final class BuddyPanel: NSPanel {
    override var canBecomeKey: Bool { true }   // so the chat box can take typing
    override var canBecomeMain: Bool { false }
}

// MARK: - sensors

enum Sensors {
    static let anyEvent = CGEventType(rawValue: ~0)!

    static func keyIdle() -> Double {
        CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .keyDown)
    }

    static func inputIdle() -> Double {
        CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyEvent)
    }

    static func screenLocked() -> Bool {
        guard let dict = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
        return (dict["CGSSessionScreenIsLocked"] as? Bool) ?? false
    }

    static func windowTitle(pid: pid_t) -> String {
        guard AXIsProcessTrusted() else { return "" }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        var window: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &window) == .success,
              let win = window else { return "" }
        var title: CFTypeRef?
        guard AXUIElementCopyAttributeValue(win as! AXUIElement, kAXTitleAttribute as CFString, &title) == .success
        else { return "" }
        return (title as? String) ?? ""
    }
}

// MARK: - app

final class BuddyApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    let config = Config.fromArgs()
    var panel: BuddyPanel!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    var hitRects: [NSRect] = []           // in web (top-left origin) coordinates
    var dragging = false
    var dragStartMouse = NSPoint.zero
    var dragStartOrigin = NSPoint.zero
    var lastMouse = NSPoint(x: -1, y: -1)
    var lastLookSent = Date.distantPast
    var mouseTimer: Timer?
    var sensorTimer: Timer?
    var retryTimer: Timer?
    var pageLoaded = false
    var lastSensorTitle = ""
    let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 2.5
        return URLSession(configuration: c)
    }()
    let ownBundle = Bundle.main.bundleIdentifier ?? "dev.lighthouse.buddy"

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.setActivationPolicy(.accessory)
        if isDuplicateInstance() { NSApp.terminate(nil); return }
        buildPanel()
        buildStatusItem()
        load()
        mouseTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in self?.mouseTick() }
        sensorTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in self?.sensorTick() }
        RunLoop.main.add(mouseTimer!, forMode: .common)
        RunLoop.main.add(sensorTimer!, forMode: .common)
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil,
                                               queue: .main) { [weak self] _ in self?.clampToScreen() }
        askAccessibilityOnce()
        sensorTick()
    }

    func isDuplicateInstance() -> Bool {
        let mine = ProcessInfo.processInfo.processIdentifier
        return NSRunningApplication.runningApplications(withBundleIdentifier: ownBundle)
            .contains { $0.processIdentifier != mine && !$0.isTerminated }
    }

    // MARK: window

    func defaultOrigin() -> NSPoint {
        let screen = NSScreen.main ?? NSScreen.screens.first!
        let vf = screen.visibleFrame
        return NSPoint(x: vf.minX + 6, y: vf.maxY - windowSize.height - 2)
    }

    func buildPanel() {
        var origin = defaultOrigin()
        if let saved = UserDefaults.standard.string(forKey: "origin") {
            let p = NSPointFromString(saved)
            if NSScreen.screens.contains(where: { $0.frame.insetBy(dx: -40, dy: -40).contains(p) }) { origin = p }
        }
        panel = BuddyPanel(contentRect: NSRect(origin: origin, size: windowSize),
                           styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.ignoresMouseEvents = true

        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "buddy")
        cfg.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: NSRect(origin: .zero, size: windowSize), configuration: cfg)
        web.setValue(false, forKey: "drawsBackground")
        web.navigationDelegate = self
        web.autoresizingMask = [.width, .height]
        panel.contentView = web
        panel.orderFrontRegardless()
        clampToScreen()
    }

    func load() {
        pageLoaded = false
        web.load(URLRequest(url: config.pageURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 4))
    }

    func scheduleRetry() {
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { [weak self] _ in self?.load() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageLoaded = true
        // Debug aid: BUDDY_SNAPSHOT=/path/shot.png writes what the web view renders (no screen-recording permission needed).
        if let path = ProcessInfo.processInfo.environment["BUDDY_SNAPSHOT"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                self?.web.takeSnapshot(with: nil) { image, _ in
                    guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                          let png = rep.representation(using: .png, properties: [:]) else { return }
                    try? png.write(to: URL(fileURLWithPath: path))
                }
            }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        scheduleRetry()
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { scheduleRetry() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { load() }

    func clampToScreen() {
        let f = panel.frame
        let screens = NSScreen.screens
        if screens.contains(where: { $0.visibleFrame.intersects(f.insetBy(dx: 60, dy: 60)) }) { return }
        panel.setFrameOrigin(defaultOrigin())
    }

    // MARK: status item

    func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "🦁"
        statusItem.button?.toolTip = "Sheru — Lighthouse buddy"
        let menu = NSMenu()
        menu.addItem(withTitle: "Show / Hide Sheru", action: #selector(toggleVisible), keyEquivalent: "s").target = self
        menu.addItem(withTitle: "Swamiji quote", action: #selector(menuQuote), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Quiet for 30 minutes", action: #selector(menuHush), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Take a 5-minute break", action: #selector(menuBreak), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Open dashboard", action: #selector(openDashboard), keyEquivalent: "d").target = self
        menu.addItem(withTitle: "Edit my goals", action: #selector(openOnboarding), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Reset position (top-left)", action: #selector(resetPosition), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Allow window titles (Accessibility)…", action: #selector(openAccessibility),
                     keyEquivalent: "").target = self
        menu.addItem(withTitle: "Reload Sheru", action: #selector(reloadPage), keyEquivalent: "r").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Sheru", action: #selector(quit), keyEquivalent: "q").target = self
        statusItem.menu = menu
    }

    @objc func toggleVisible() { panel.isVisible ? panel.orderOut(nil) : panel.orderFrontRegardless() }
    @objc func menuQuote() { postAction("quote") }
    @objc func menuHush() { postAction("hush", minutes: 30) }
    @objc func menuBreak() { postAction("break", minutes: 5) }
    @objc func openDashboard() { open(config.dashboard) }
    @objc func openOnboarding() { open(config.dashboard + "/?onboarding=1") }
    @objc func reloadPage() { load() }
    @objc func quit() { NSApp.terminate(nil) }
    @objc func resetPosition() {
        panel.setFrameOrigin(defaultOrigin())
        UserDefaults.standard.removeObject(forKey: "origin")
    }
    @objc func openAccessibility() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        open("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
    }

    func askAccessibilityOnce() {
        guard !AXIsProcessTrusted(), !UserDefaults.standard.bool(forKey: "askedAX") else { return }
        UserDefaults.standard.set(true, forKey: "askedAX")
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    }

    func open(_ s: String) {
        if let url = URL(string: s) { NSWorkspace.shared.open(url) }
    }

    func postAction(_ action: String, minutes: Double? = nil) {
        var body: [String: Any] = ["action": action]
        if let m = minutes { body["minutes"] = m }
        post(path: "/api/buddy/action", body: body)
        if !panel.isVisible { panel.orderFrontRegardless() }
    }

    func post(path: String, body: [String: Any]) {
        guard let url = URL(string: config.base + path),
              let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        session.dataTask(with: req).resume()
    }

    // MARK: mouse: click-through, eyes, dragging

    func mouseTick() {
        let m = NSEvent.mouseLocation
        let f = panel.frame
        if dragging {
            if NSEvent.pressedMouseButtons & 1 == 0 {
                dragging = false
                UserDefaults.standard.set(NSStringFromPoint(panel.frame.origin), forKey: "origin")
            } else {
                let o = NSPoint(x: dragStartOrigin.x + (m.x - dragStartMouse.x), y: dragStartOrigin.y + (m.y - dragStartMouse.y))
                panel.setFrameOrigin(o)
            }
            return
        }
        let local = NSPoint(x: m.x - f.minX, y: f.maxY - m.y)  // web coordinates
        let inside = hitRects.contains { $0.contains(local) }
        if panel.ignoresMouseEvents == inside { panel.ignoresMouseEvents = !inside }

        if pageLoaded, abs(m.x - lastMouse.x) + abs(m.y - lastMouse.y) > 1.5,
           Date().timeIntervalSince(lastLookSent) > 0.05 {
            lastMouse = m
            lastLookSent = Date()
            web.evaluateJavaScript("window.sheru && window.sheru.look(\(Int(local.x)), \(Int(local.y)))", completionHandler: nil)
        }
    }

    // MARK: JS bridge

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "hit":
            let rects = (body["rects"] as? [[String: Any]]) ?? []
            hitRects = rects.compactMap { r in
                guard let x = (r["x"] as? NSNumber)?.doubleValue, let y = (r["y"] as? NSNumber)?.doubleValue,
                      let w = (r["w"] as? NSNumber)?.doubleValue, let h = (r["h"] as? NSNumber)?.doubleValue else { return nil }
                return NSRect(x: x, y: y, width: w, height: h)
            }
        case "dragStart":
            dragging = true
            dragStartMouse = NSEvent.mouseLocation
            dragStartOrigin = panel.frame.origin
        case "activate":
            if let bid = body["bundleId"] as? String,
               let app = NSRunningApplication.runningApplications(withBundleIdentifier: bid).first {
                if #available(macOS 14.0, *) { app.activate() } else { app.activate(options: [.activateIgnoringOtherApps]) }
            }
        case "open":
            if let s = body["url"] as? String { open(s) }
        case "focus":
            panel.makeKeyAndOrderFront(nil)
        case "blur":
            if panel.isKeyWindow { panel.resignKey() }
        default:
            break
        }
    }

    // MARK: desktop sensor

    func sensorTick() {
        let front = NSWorkspace.shared.frontmostApplication
        var app = front?.localizedName ?? ""
        var bundle = front?.bundleIdentifier ?? ""
        var title = ""
        if let pid = front?.processIdentifier, bundle != ownBundle {
            title = Sensors.windowTitle(pid: pid)
        }
        if bundle == ownBundle { app = "Lighthouse Buddy"; bundle = ownBundle; title = "" }
        let body: [String: Any] = [
            "app": app, "bundleId": bundle, "title": String(title.prefix(400)),
            "keyIdle": Sensors.keyIdle(), "inputIdle": Sensors.inputIdle(),
            "locked": Sensors.screenLocked(), "axTrusted": AXIsProcessTrusted(),
        ]
        post(path: "/api/desktop/sample", body: body)
    }
}

// MARK: - main

let app = NSApplication.shared
let delegate = BuddyApp()
app.delegate = delegate
app.run()
