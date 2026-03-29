def get_stream_extractor_helpers():
    from backend import main as main_module

    return {
        "resolve_embed_target": main_module._resolve_embed_target,
        "extract_stream_url": main_module._extract_stream_url,
        "extract_stream_url_via_browser": main_module._extract_stream_url_via_browser,
    }
