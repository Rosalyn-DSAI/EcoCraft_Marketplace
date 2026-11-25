"""Shared admin blueprint mounted at /api/admin."""
from flask import Blueprint

admin_bp = Blueprint("admin", __name__)
