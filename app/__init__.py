"""EcoCraft Flask factory: configuration, marketplace pages and API blueprint registration."""
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template
from flask_cors import CORS

from .routes.health import health_bp
from .routes.auth import auth_bp
from .routes.admin import admin_bp
from .routes.shop import shop_bp


def create_app(test_config=None):
    # Always resolve the .env relative to this project, not the shell working dir.
    """Build Flask configuration and routes; tests can override settings without opening Atlas."""
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
    app = Flask(__name__)
    app.config.update(
        MONGO_URI=os.getenv("MONGO_URI", ""),
        MONGO_USERNAME=os.getenv("MONGO_USERNAME", ""),
        MONGO_PASSWORD=os.getenv("MONGO_PASSWORD", ""),
        MONGO_DB_NAME=os.getenv("MONGO_DB_NAME", "ecocraft"),
        MONGO_TIMEOUT_MS=int(os.getenv("MONGO_TIMEOUT_MS", "5000")),
        JSON_SORT_KEYS=False,
        JWT_SECRET_KEY=os.getenv("JWT_SECRET_KEY", ""),
        JWT_EXP_MINUTES=int(os.getenv("JWT_EXP_MINUTES", "60")),
        ENABLE_DEV_WRITES=os.getenv("ENABLE_DEV_WRITES", "false").lower() == "true",
        ENABLE_TEAM_DEMO_WRITES=os.getenv("ENABLE_TEAM_DEMO_WRITES", "false").lower() == "true",
        ALLOWED_ORIGINS=os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"),
        MAX_CONTENT_LENGTH=16 * 1024,
        CLOUDINARY_CLOUD_NAME=os.getenv("CLOUDINARY_CLOUD_NAME", ""),
        CLOUDINARY_API_KEY=os.getenv("CLOUDINARY_API_KEY", ""),
        CLOUDINARY_API_SECRET=os.getenv("CLOUDINARY_API_SECRET", ""),
    )
    if test_config:
        app.config.update(test_config)

    origins = [x.strip() for x in app.config["ALLOWED_ORIGINS"].split(",") if x.strip()]
    CORS(app, resources={r"/api/*": {"origins": origins}}, supports_credentials=False)

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(shop_bp, url_prefix="/api")

    @app.get("/")
    def marketplace_home():
        return render_template("marketplace.html")

    @app.errorhandler(404)
    def route_not_found(_error):
        return jsonify(error={"code": "NOT_FOUND", "message": "Endpoint not found"}), 404

    @app.errorhandler(405)
    def method_not_allowed(_error):
        return jsonify(error={"code": "METHOD_NOT_ALLOWED", "message": "HTTP method is not supported"}), 405

    @app.errorhandler(413)
    def payload_too_large(_error):
        return jsonify(error={"code": "PAYLOAD_TOO_LARGE", "message": "Request exceeds the size limit"}), 413

    return app
