# -*- coding: utf-8 -*-
"""Serve Links Plugin Entry Point."""

import logging

from qwenpaw.plugins.api import PluginApi

logger = logging.getLogger(__name__)


class ServeLinksPlugin:
    """Serve Links — 将 raw_links JSON 文件通过 qwenpaw 核心 FastAPI 暴露给前端。"""

    def register(self, api: PluginApi):
        """Register serve_links HTTP router.

        Args:
            api: PluginApi instance
        """
        logger.info("Registering Serve Links plugin...")

        # 启动时将 APIRouter 挂载到 /api/serve_links/ 下
        from .serve_links import build_router
        api.register_http_router(
            build_router(),
            prefix="/serve_links",
            tags=["serve_links"],
        )

        logger.info("✓ Serve Links registered at /api/serve_links")


# Export plugin instance
plugin = ServeLinksPlugin()
