# qwenpaw_plugin_tools
some tools for qwenpaw dev on ecs

### Serve Links v1.0.2
- 通过 qwenpaw 核心 FastAPI 在 /api/serve_links/ 下暴露 .qwenpaw 目录下路径/文件的服务
- 通过 plugin hook 伴随主程序启动，不必手动启动
- 在 serve_links.py 的 QWENPAW_DIR 手动调整实际主程序工作路径，比如.copaw或其他（默认路径为~/.qwenpaw则不用修改）
- 通过 serve_links.py 的 _SKIP_DIRS 和 _SKIP_FILES 控制不想读取和展示的路径/文件
- 可以 serve_links.py 中添加新路由以实现个性化功能

### File Browser v1.0.2
- 必须安装 Serve Links 暴露文件层级才能使用
- 类似文件管理器的GUI便捷的查看 QwenPaw 工作区的路径/文件
