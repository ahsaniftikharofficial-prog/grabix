from fastapi import APIRouter, Request

from app.services.supabase_auth import auth_config_snapshot, require_supabase_user

router = APIRouter()


@router.get("/auth/status")
def auth_status():
    return auth_config_snapshot()


@router.get("/auth/me")
async def auth_me(request: Request):
    user = await require_supabase_user(request)
    return {
        "provider": "supabase",
        "user": {
            "id": user.get("id"),
            "email": user.get("email"),
            "phone": user.get("phone"),
            "role": user.get("role"),
            "email_confirmed_at": user.get("email_confirmed_at"),
            "last_sign_in_at": user.get("last_sign_in_at"),
            "app_metadata": user.get("app_metadata") or {},
            "user_metadata": user.get("user_metadata") or {},
        },
    }
