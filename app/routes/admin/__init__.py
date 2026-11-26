"""Admin API blueprint (mounted at /api/admin), assembled from functional modules."""
from . import admin_insights, artists, moderation  # noqa: F401
from .common import admin_bp

__all__ = ['admin_bp']
