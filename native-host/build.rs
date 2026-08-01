fn main() {
    #[cfg(windows)]
    {
        // webview2-com loader needs advapi32 (ETW + registry APIs).
        println!("cargo:rustc-link-lib=advapi32");

        // Embed installer logo (build/icon.ico) as the .exe file icon.
        let ico = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("build")
            .join("icon.ico");
        println!("cargo:rerun-if-changed={}", ico.display());
        let mut res = winres::WindowsResource::new();
        if ico.is_file() {
            res.set_icon(ico.to_str().expect("ico path utf-8"));
        }
        res.set("ProductName", "Cognitience WP");
        res.set("FileDescription", "Cognitience WP — local-first word processor");
        res.set("CompanyName", "Cognitience");
        res.set("LegalCopyright", "Cognitience");
        // AppUserModelID-friendly description for taskbar grouping.
        if let Err(e) = res.compile() {
            eprintln!("cargo:warning=winres failed (exe icon may be missing): {e}");
        }
    }
}
