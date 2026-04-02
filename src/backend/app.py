import logging
import os

from flask import Flask

from config import Config
from services.cosmos_service import CosmosService
from routes.auth_routes import auth_bp
from routes.teams_routes import teams_bp
from routes.document_routes import document_bp

logging.basicConfig(level=logging.INFO)

app = Flask(__name__, static_folder="static", static_url_path="")
app.config.from_object(Config)
app.secret_key = os.urandom(32)

# Initialize Cosmos DB service (singleton)
cosmos_service = CosmosService(app.config)
app.config["COSMOS_SERVICE"] = cosmos_service

# Register blueprints
app.register_blueprint(auth_bp, url_prefix="/api")
app.register_blueprint(teams_bp, url_prefix="/api")
app.register_blueprint(document_bp, url_prefix="/api")


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/<path:path>")
def static_files(path):
    return app.send_static_file(path)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
