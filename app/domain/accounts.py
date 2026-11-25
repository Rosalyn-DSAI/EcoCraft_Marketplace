"""Account validation helpers (registration and profile edits); frontend and backend agree on these fields."""
import re

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
NAME_MAX = 100


def clean_email(value):
    """Normalize a syntactically valid email to lowercase, or return None."""
    if not isinstance(value, str):
        return None
    email = value.strip().lower()
    if len(email) > 254 or not EMAIL_RE.fullmatch(email):
        return None
    return email


def clean_name(value):
    """Trim a nonempty name within the shared name-length limit, or return None."""
    if not isinstance(value, str):
        return None
    name = value.strip()
    if not (1 <= len(name) <= NAME_MAX):
        return None
    return name


def validate_registration(payload):
    """Return (data, problem, field) for registration; field names the failing input for logging."""
    if not isinstance(payload, dict):
        return None, "JSON object expected", "body"
    allowed = {"email", "password", "role", "firstName", "lastName", "originStory"}
    if set(payload) - allowed:
        return None, "Unknown registration fields are not permitted", "unknownFields:" + ",".join(sorted(set(payload) - allowed))
    role = payload.get("role")
    if not isinstance(role, str) or role not in {"customer", "artist"}:
        return None, "Only customer and artist accounts can register publicly", "role"
    email = clean_email(payload.get("email"))
    first = clean_name(payload.get("firstName"))
    last = clean_name(payload.get("lastName"))
    password = payload.get("password")
    if not email:
        return None, "Valid email, firstName and lastName are required", "email"
    if not first:
        return None, "Valid email, firstName and lastName are required", "firstName"
    if not last:
        return None, "Valid email, firstName and lastName are required", "lastName"
    if not isinstance(password, str) or not (10 <= len(password) <= 128):
        return None, "Password must be between 10 and 128 characters", "password"
    story = payload.get("originStory")
    if role == "artist":
        if not isinstance(story, str) or not (1 <= len(story.strip()) <= 2000):
            return None, "Artist originStory must contain 1-2000 characters", "originStory"
        story = story.strip()
    elif "originStory" in payload:
        return None, "originStory is only available for artist accounts", "originStory"
    return {"email": email, "password": password, "role": role, "firstName": first, "lastName": last, "originStory": story}, None, None


def validate_profile_changes(payload, role=None):
    """Allow only editable personal fields and return dotted MongoDB update paths."""
    if not isinstance(payload, dict):
        return None, "JSON object expected"
    allowed = {"firstName", "lastName", "mobile", "originStory"}
    if not payload or set(payload) - allowed:
        return None, "Only firstName, lastName, mobile and originStory may be updated"
    changes = {}
    for field in ("firstName", "lastName"):
        if field in payload:
            value = clean_name(payload[field])
            if value is None:
                return None, f"{field} must contain 1-100 characters"
            changes[f"personalInfo.{field}"] = value
    if "mobile" in payload:
        mobile = payload["mobile"]
        if not isinstance(mobile, str) or len(mobile.strip()) > 30:
            return None, "mobile must be a string up to 30 characters"
        changes["personalInfo.mobile"] = mobile.strip()
    if "originStory" in payload:
        if role != "artist":
            return None, "originStory is only available for artist accounts"
        story = payload["originStory"]
        if not isinstance(story, str) or not (1 <= len(story.strip()) <= 2000):
            return None, "Artist originStory must contain 1-2000 characters"
        changes["artistProfile.originStory"] = story.strip()
    return changes, None
