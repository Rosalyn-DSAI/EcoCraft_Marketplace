"""Create ONE permanent, shared course-project admin in the existing ecocraft DB.

Usage from the project's root, with your existing virtual environment and .env:
    python -m scripts_admin.create_shared_admin

This script performs at most ONE insert into ecocraft.users. It has no update,
replace, delete, drop, or schema/index modification paths. It never prints a
password or a database connection URI.
"""

from __future__ import annotations

import getpass
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError, PyMongoError
from werkzeug.security import generate_password_hash

from app.db import stamp_insert
from app.domain.accounts import clean_email, clean_name

ROOT = Path(__file__).resolve().parents[1]
TEAM_ADMIN_ID = "WEB26-ADM-TEAM-2026"
CONFIRMATION = "CREATE TEAM ADMIN IN ecocraft"


class ExistingAccountError(Exception):
    """A shared admin or the chosen email is already in use."""


def configuration_error(env: dict[str, str]) -> str | None:
    """Fail closed unless the shared database AND explicit demo-write opt-in match."""
    if env.get("MONGO_DB_NAME", "") != "ecocraft":
        return "MONGO_DB_NAME must be exactly ecocraft."
    if env.get("ENABLE_TEAM_DEMO_WRITES", "").strip().lower() != "true":
        return "Set ENABLE_TEAM_DEMO_WRITES=true only after team approval and backup."
    if not env.get("MONGO_URI", "").strip():
        return "MONGO_URI is missing."
    if bool(env.get("MONGO_USERNAME", "")) != bool(env.get("MONGO_PASSWORD", "")):
        return "MONGO_USERNAME and MONGO_PASSWORD must both be set, or both omitted."
    return None


def prepare_document(email: str, first: str, last: str, password: str) -> dict:
    """Build a document matching the team's strict MongoDB users validator."""
    normalized_email = clean_email(email)
    first_name = clean_name(first)
    last_name = clean_name(last)
    if not normalized_email or not first_name or not last_name:
        raise ValueError("Use a valid email and nonempty first and last names (max 100 characters).")
    if not isinstance(password, str) or not 16 <= len(password) <= 128:
        raise ValueError("Use a unique password between 16 and 128 characters.")
    return {
        "userID": TEAM_ADMIN_ID,
        "email": normalized_email,
        "passwordHash": generate_password_hash(password),
        "role": "admin",
        "personalInfo": {"firstName": first_name, "lastName": last_name},
    }


def insert_once(users, document: dict):
    """Single insert, never updates existing accounts, including original ADM001/2."""
    if users.find_one({"$or": [
        {"userID": TEAM_ADMIN_ID},
        {"email": document["email"]},
    ]}):
        raise ExistingAccountError("The team admin or chosen email already exists; no changes made.")
    # Atomic unique indexes on users.userID and users.email also prevent races.
    return users.insert_one(stamp_insert(document))


def run() -> int:
    """Require interactive confirmation before one additional shared-admin insert; never update seeds."""
    load_dotenv(ROOT / ".env", override=False)
    env = dict(os.environ)
    error = configuration_error(env)
    if error:
        print("REFUSED: " + error)
        return 2
    if not sys.stdin.isatty():
        print("REFUSED: Run interactively in your own VS Code PowerShell terminal.")
        return 2

    print("\nEcoCraft: create ONE additional permanent course-project admin")
    print("Target database: ecocraft | Collection: users | Operation: insert ONE document")
    print("Existing seeded admin accounts will NOT be modified.")
    print("Use a team-controlled email, not the MongoDB Atlas database login.")
    print("Use a unique 20+ character random password and store it in a team password vault.\n")
    try:
        email = input("New team-admin email: ")
        first = input("First name/display label (e.g. EcoCraft): ")
        last = input("Last name/display label (e.g. Team): ")
        password = getpass.getpass("New account password (hidden): ")
        repeated = getpass.getpass("Repeat password (hidden): ")
        if password != repeated:
            print("REFUSED: Password confirmation did not match.")
            return 2
        document = prepare_document(email, first, last, password)
    except (ValueError, EOFError, KeyboardInterrupt) as exc:
        print("REFUSED: " + (str(exc) if isinstance(exc, ValueError) else "Input cancelled."))
        return 2
    finally:
        # Never print or store raw passwords in files or logs.
        if "repeated" in locals():
            del repeated
        if "password" in locals():
            del password

    print(f"\nNew admin email: {document['email']}")
    print(f"New userID: {TEAM_ADMIN_ID}")
    try:
        choice = input(f"Type '{CONFIRMATION}' to create exactly one new record: ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\nCancelled: no write attempted.")
        return 2
    if choice != CONFIRMATION:
        print("Cancelled: no write attempted.")
        return 2

    kwargs = {"serverSelectionTimeoutMS": 5000, "appname": "EcoCraft-SharedAdmin-Setup"}
    if env.get("MONGO_USERNAME"):
        kwargs["username"] = env["MONGO_USERNAME"]
        kwargs["password"] = env["MONGO_PASSWORD"]

    client = None
    try:
        client = MongoClient(env["MONGO_URI"], **kwargs)
        db = client["ecocraft"]
        db.command("ping")
        if "users" not in db.list_collection_names():
            print("REFUSED: Target database does not contain the expected users collection.")
            return 2
        result = insert_once(db.users, document)
        print("\nSUCCESS: Created the ONE new shared admin in ecocraft.users.")
        print(f"Email: {document['email']}")
        print(f"userID: {TEAM_ADMIN_ID}")
        print(f"MongoDB _id: {result.inserted_id}")
        print("Now sign in through the EcoCraft website with the email and password you chose.")
        print("Keep the credentials in the team's secure password manager, not in Git or chat.")
        return 0
    except ExistingAccountError as exc:
        print("REFUSED: " + str(exc))
        return 1
    except DuplicateKeyError:
        print("REFUSED: Duplicate userID or email; an account already exists. No seeded record changed.")
        return 1
    except PyMongoError as exc:
        print("FAILED: MongoDB operation error (" + type(exc).__name__ + ").")
        print("Check the Atlas connection and whether the users validator/unique indexes are present.")
        return 1
    finally:
        if client is not None:
            client.close()


if __name__ == "__main__":
    raise SystemExit(run())
