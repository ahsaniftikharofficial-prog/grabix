def get_history_helpers():
    from backend import main as main_module

    return {
        "init_db": main_module.init_db,
        "get_db_connection": main_module.get_db_connection,
        "db_insert": main_module.db_insert,
        "db_update_status": main_module.db_update_status,
    }
