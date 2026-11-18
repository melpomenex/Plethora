use tauri::utils::acl::RemoteUrlPattern;

#[test]
fn grouped_launch_origins_match_the_same_urls_as_four_literal_patterns() {
    let previous = [
        "http://localhost:9527/*",
        "http://127.0.0.1:9527/*",
        "http://localhost:15173/*",
        "http://127.0.0.1:15173/*",
    ]
    .map(|pattern| pattern.parse::<RemoteUrlPattern>().unwrap());
    for capability in [
        include_str!("../capabilities/default.json"),
        include_str!("../capabilities/interface-zoom.json"),
    ] {
        let config: serde_json::Value = serde_json::from_str(capability).unwrap();
        let patterns = config["remote"]["urls"].as_array().unwrap();
        assert_eq!(patterns.len(), 1);
        let grouped = patterns[0]
            .as_str()
            .unwrap()
            .parse::<RemoteUrlPattern>()
            .unwrap();
        for scheme in ["http", "https", "ftp"] {
            for host in [
                "localhost",
                "127.0.0.1",
                "127.1",
                "127.0.0.2",
                "localhost.",
                "localhost.example",
                "user:pass@localhost",
                "[::1]",
            ] {
                for port in ["", ":9527", ":15173", ":9528", ":15174", ":80"] {
                    for path in ["/", "/assets/app.js", "/path?q=1#main"] {
                        let address = format!("{scheme}://{host}{port}{path}");
                        let url = address.parse().unwrap();
                        assert_eq!(
                            grouped.test(&url),
                            previous.iter().any(|pattern| pattern.test(&url)),
                            "{address}"
                        );
                    }
                }
            }
        }
    }
}
