"""Token authentication and explicit opt-in controls for shared-database demonstration writes."""
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from bson import ObjectId
from flask import current_app, g, jsonify, request
from pymongo.errors import PyMongoError

from .db import get_database


# Only user documents inserted by THIS registration endpoint use these prefixes.
# Seed users have IDs such as ART001 / CUS001; their profiles remain read-only.
WEB_USER_PREFIXES = ("WEB26-CUS-", "WEB26-ART-")

# Messages for artists who cannot sign in yet; keys match artistProfile.onboardingStatus values.
ARTIST_ONBOARDING_MESSAGES = {
    "request_received": "Your artist application has been received. We will ask you for documents shortly.",
    "waiting_for_documents": "Please send the documents we requested. We will review them once received.",
    "received_documents": "Your documents were received and your profile is under review.",
    "rejected": "Your artist application was not approved. Please contact support for details.",
    None: "Your artist registration is still in progress. You can sign in once it is approved.",
}


def artist_not_approved_message(user):
    """Return the onboarding-specific sign-in message for an artist who is not approved."""
    status = user.get("artistProfile", {}).get("onboardingStatus")
    return ARTIST_ONBOARDING_MESSAGES.get(status, ARTIST_ONBOARDING_MESSAGES[None])


def is_valid_jwt_secret(secret):
    """Reject short or unchanged placeholder signing secrets."""
    return isinstance(secret, str) and len(secret) >= 32 and not secret.startswith(("PASTE_", "REPLACE_", "CHANGEME"))


def api_error(code, message, status):
    """Return the common JSON error envelope with an explicit HTTP status."""
    return jsonify(error={"code": code, "message": message}), status


def require_write_enabled():
    """Opt-in write gate. Existing seeded users remain protected by can_edit_user().

    In the shared ecocraft database ONLY controlled routes for new demo records may
    write. Never use this generic gate by itself to authorize a record mutation.
    """
    db_name = current_app.config.get("MONGO_DB_NAME", "").lower()
    if db_name == "ecocraft":
        if current_app.config.get("ENABLE_TEAM_DEMO_WRITES") is True:
            return None
        return api_error("TEAM_DEMO_WRITES_DISABLED", "Enable shared-database demo writes explicitly", 403)
    if db_name.endswith("_dev") and current_app.config.get("ENABLE_DEV_WRITES") is True:
        return None
    return api_error("WRITES_DISABLED", "Database writes are disabled for this configuration", 403)


def can_edit_user(user):
    """Fail closed: never modify a teammate-seeded user in the shared database.

    Only registration-created accounts bearing a server-generated WEB26 userID are
    eligible for controlled shared-database writes. Clients cannot submit a userID.
    """
    if current_app.config.get("MONGO_DB_NAME", "").lower() != "ecocraft":
        return True  # Existing isolated test-database behavior.
    return (isinstance(user, dict) and
            isinstance(user.get("userID"), str) and
            user["userID"].startswith(WEB_USER_PREFIXES) and
            user.get("role") in {"artist", "customer"})


def create_access_token(user):
    """Sign an expiring identity token; roles are reloaded from MongoDB on each request."""
    secret = current_app.config.get("JWT_SECRET_KEY", "")
    if not is_valid_jwt_secret(secret):
        raise ValueError("JWT_SECRET_KEY must contain at least 32 characters")
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(minutes=int(current_app.config["JWT_EXP_MINUTES"]))
    token = jwt.encode({"sub": str(user["_id"]), "iat": now, "exp": expiry, "iss": "ecocraft-local"}, secret, algorithm="HS256")
    return token, int((expiry - now).total_seconds())


def public_user(user):
    """Project the supported public profile fields without exposing password hashes."""
    return {
        "id": str(user["_id"]),
        "userID": user["userID"],
        "email": user["email"],
        "role": user["role"],
        "personalInfo": user["personalInfo"],
        **({"artistProfile": user["artistProfile"]} if "artistProfile" in user else {}),
    }


def auth_required(*roles):
    """Authenticate Bearer JWT, reload role from DB, optionally restrict roles."""
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            header = request.headers.get("Authorization", "")
            parts = header.split(" ")
            if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1]:
                return api_error("AUTH_REQUIRED", "Provide a Bearer access token", 401)
            secret = current_app.config.get("JWT_SECRET_KEY", "")
            if not is_valid_jwt_secret(secret):
                return api_error("AUTH_NOT_CONFIGURED", "Authentication is not configured", 503)
            try:
                claims = jwt.decode(parts[1], secret, algorithms=["HS256"], issuer="ecocraft-local", options={"require": ["sub", "iat", "exp", "iss"]})
                if not ObjectId.is_valid(claims["sub"]):
                    raise jwt.InvalidTokenError("Invalid subject")
            except jwt.ExpiredSignatureError:
                return api_error("TOKEN_EXPIRED", "Access token has expired; please sign in again", 401)
            except (jwt.InvalidTokenError, TypeError, ValueError):
                return api_error("INVALID_TOKEN", "Invalid access token", 401)
            try:
                user = get_database().users.find_one({"_id": ObjectId(claims["sub"])})
            except PyMongoError:
                current_app.logger.exception("MongoDB error checking access token")
                return api_error("DATABASE_UNAVAILABLE", "Database temporarily unavailable", 503)
            if user is None:
                return api_error("INVALID_TOKEN", "Account no longer exists", 401)
            if user.get("active") is False:
                return api_error("ACCOUNT_DISABLED", "This account is no longer active", 401)
            if user["role"] == "artist" and user.get("artistProfile", {}).get("onboardingStatus") != "approved":
                return api_error("ARTIST_NOT_APPROVED", artist_not_approved_message(user), 403)
            if roles and user["role"] not in roles:
                return api_error("FORBIDDEN", "You are not allowed to perform this action", 403)
            g.current_user = user
            return fn(*args, **kwargs)
        return wrapped
    return decorator
