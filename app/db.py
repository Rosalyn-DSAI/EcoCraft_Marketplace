"""Shared MongoDB client; never opens a connection just by importing the app."""
from datetime import datetime, timezone

from flask import current_app
from pymongo import MongoClient


class DatabaseConfigurationError(Exception):
    """Expected configuration problem (credentials or host missing)."""


def utc_now():
    return datetime.now(timezone.utc)


def stamp_insert(doc):
    """Set createdAt and updatedAt (equal) on a new document before insert_one."""
    now = utc_now()
    doc["createdAt"] = now
    doc["updatedAt"] = now
    return doc


def stamp_update(changes):
    """Return a $set dict with updatedAt refreshed; createdAt is never overwritten."""
    changes.pop("createdAt", None)
    changes["updatedAt"] = utc_now()
    return changes


def get_client():
    """Lazily cache one PyMongo client per Flask app; injected test clients take precedence."""
    app = current_app._get_current_object()
    if "mongo_client" in app.extensions:
        return app.extensions["mongo_client"]

    uri = app.config.get("MONGO_URI", "").strip()
    username = app.config.get("MONGO_USERNAME", "")
    password = app.config.get("MONGO_PASSWORD", "")
    if not uri:
        raise DatabaseConfigurationError("MONGO_URI is not configured")
    if bool(username) != bool(password):
        raise DatabaseConfigurationError("Database username and password must both be set")

    kwargs = {
        "serverSelectionTimeoutMS": app.config.get("MONGO_TIMEOUT_MS", 5000),
        "appname": "EcoCraft-Backend",
    }
    # Passing separately avoids manually URL-encoding special characters in the password.
    if username:
        kwargs.update(username=username, password=password)
    client = MongoClient(uri, **kwargs)
    app.extensions["mongo_client"] = client
    return client


def get_database():
    """Select the configured database through the shared client; do not create schema or indexes."""
    return get_client()[current_app.config["MONGO_DB_NAME"]]
