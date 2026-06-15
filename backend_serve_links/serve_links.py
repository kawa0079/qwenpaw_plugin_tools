"""
Serve Links Plugin — .qwenpaw 目录&文件静态读取
通过 APIRouter 挂载到 qwenpaw 核心的 /api/serve_links/ 路径下，
提供 .qwenpaw 目录的层级浏览与文件读取接口。
"""
import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------

# QWENPAW 工作路径
QWENPAW_DIR = Path.home() / ".qwenpaw"

# 在树形遍历时跳过的目录名（不想展示的路径）
_SKIP_DIRS = {"__pycache__", ".git", "node_modules", "bin", "venv"}

# 在树形遍历时跳过的文件名（不想展示的文件名）
_SKIP_FILES = {
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    ".gitignore",
    ".gitkeep",
    ".env",
    ".env.local",
}

# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------


def _is_hidden_entry(name: str, is_dir: bool, rel_parts: list[str] | None = None) -> bool:
    """判断一个目录/文件是否应被过滤隐藏。

    Args:
        name:      条目名称（不含路径）
        is_dir:    是否为目录
        rel_parts: 该条目相对于 .qwenpaw 的路径分段列表，
                   用于检测父目录链中是否包含 _SKIP_DIRS。
    """
    if is_dir and name in _SKIP_DIRS:
        return True
    if not is_dir and name in _SKIP_FILES:
        return True
    # 检查路径中是否有任何祖先目录属于 _SKIP_DIRS
    if rel_parts:
        for part in rel_parts[:-1]:  # 最后一段是当前条目自身，已由上面判断
            if part in _SKIP_DIRS:
                return True
    return False


def resolve_safe_path(rel_path: str) -> Path:
    """将相对路径解析到 .qwenpaw 目录内，防止路径穿越。

    路径穿越尝试返回 403，路径不存在返回 404。
    """
    if ".." in rel_path or rel_path.startswith("/") or "\\" in rel_path:
        raise HTTPException(status_code=403, detail="path traversal denied")
    root = QWENPAW_DIR.resolve()
    try:
        target = (QWENPAW_DIR / rel_path).resolve(strict=True)
    except (OSError, RuntimeError):
        raise HTTPException(status_code=404, detail=f"{rel_path} not found")
    # 确保目标仍在 .qwenpaw 目录树内
    try:
        target.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=403, detail="path traversal denied")
    return target


def build_file_tree(root: Path) -> dict:
    """递归构建目录树，返回嵌套 JSON 结构。

    结构示例::

        {"name": "workspaces", "type": "dir", "children": [
            {"name": "a.json", "type": "file"},
            ...
        ]}
    """
    node: dict = {"name": root.name, "type": "dir", "children": []}
    try:
        entries = sorted(root.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError:
        return node
    for entry in entries:
        if entry.is_dir():
            if entry.name in _SKIP_DIRS:
                continue
            node["children"].append(build_file_tree(entry))
        elif entry.is_file():
            if entry.name in _SKIP_FILES:
                continue
            node["children"].append({"name": entry.name, "type": "file"})
    return node


# ---------------------------------------------------------------------------
# Router 构建
# ---------------------------------------------------------------------------


def build_router() -> APIRouter:
    """构建 serve_links 的 APIRouter。

    路由挂载在 ``/api`` + prefix 下。
    当 ``prefix="/serve_links"`` 时，下方路由对应：
      - GET /api/serve_links/health
      - GET /api/serve_links/ls_all
      - GET /api/serve_links/ls_{path}
      - GET /api/serve_links/get_{path}
    """
    router = APIRouter()

    @router.get("/health")
    def health():
        """前端用这个端点判断服务是否在线。"""
        return {"ok": True, "dir": str(QWENPAW_DIR)}

    # -- .qwenpaw 目录浏览 --------------------------------------------------

    @router.get("/ls_all")
    def ls_all():
        """返回 .qwenpaw 目录下完整的文件层级树（嵌套 JSON）。"""
        if not QWENPAW_DIR.is_dir():
            raise HTTPException(status_code=404, detail=".qwenpaw dir not found")
        return build_file_tree(QWENPAW_DIR)

    @router.get("/ls_{path:path}")
    def ls_dir(path: str):
        """列出 .qwenpaw 下指定目录的单层内容。

        返回 [{name, type}, ...]，type 为 "dir" 或 "file"。
        自动过滤 _SKIP_DIRS 中的目录和 _SKIP_FILES 中的文件。
        """
        target = resolve_safe_path(path)
        if not target.is_dir():
            raise HTTPException(status_code=400, detail=f"{path} is not a directory")
        # 如果请求的目录本身在 _SKIP_DIRS 中，拒绝访问
        dir_parts = [p for p in path.split("/") if p]
        for part in dir_parts:
            if part in _SKIP_DIRS:
                raise HTTPException(status_code=404, detail=f"{path} not found")
        entries = []
        try:
            for entry in sorted(
                target.iterdir(),
                key=lambda p: (not p.is_dir(), p.name.lower()),
            ):
                is_dir = entry.is_dir()
                if _is_hidden_entry(entry.name, is_dir):
                    continue
                entries.append(
                    {"name": entry.name, "type": "dir" if is_dir else "file"}
                )
        except PermissionError:
            raise HTTPException(status_code=403, detail="permission denied")
        return entries

    @router.get("/get_{path:path}")
    def get_file_content(path: str):
        """读取 .qwenpaw 下指定文件内容并以纯文本返回。

        二进制或无法解码的文件返回 "unreadable format"。
        自动过滤 _SKIP_FILES 中的文件及 _SKIP_DIRS 路径下的文件。
        """
        target = resolve_safe_path(path)
        if not target.is_file():
            raise HTTPException(status_code=400, detail=f"{path} is not a file")
        # 检查文件名是否在 _SKIP_FILES 中
        file_parts = [p for p in path.split("/") if p]
        if _is_hidden_entry(target.name, False, file_parts):
            raise HTTPException(status_code=404, detail=f"{path} not found")
        try:
            content = target.read_text(encoding="utf-8")
            return content
        except (UnicodeDecodeError, ValueError):
            return "unreadable format"


    return router
