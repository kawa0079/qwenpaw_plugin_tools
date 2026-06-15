// 由 QwenPaw Console 动态 import 加载。
// 不要 import React —— 必须从宿主取用，否则会出现两份 React 实例。
const { React, antd } = (window as any).QwenPaw.host;
const { useState, useEffect, useCallback, useMemo } = React;
const { Card, Input, Alert, Button, Empty, Spin, Tooltip, Breadcrumb } = antd;

const BASE = "/api/serve_links";
const HEALTH_URL = `${BASE}/health`;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TreeNode {
  name: string;
  type: "dir" | "file";
  path: string;
  children: TreeNode[];
  loaded: boolean;
  loading: boolean;
}

interface DirEntry {
  name: string;
  type: "dir" | "file";
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function getFileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** 对路径的每一段做 URL 编码，保留 "/" 分隔符 */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function FileBrowser() {
  /* ---- State ---- */
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedType, setSelectedType] = useState<"dir" | "file" | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [dirEntries, setDirEntries] = useState<DirEntry[]>([]);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [loadingDir, setLoadingDir] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");

  /* ---- 健康检查 ---- */
  const checkServer = useCallback(async () => {
    try {
      const res = await fetch(HEALTH_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.json();
      setServerOk(true);
    } catch {
      setServerOk(false);
    }
  }, []);

  /* ---- 加载根目录 ---- */
  const loadRoot = useCallback(async () => {
    setLoadingTree(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/ls_`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries: DirEntry[] = await res.json();

      const rootNode: TreeNode = {
        name: ".qwenpaw",
        type: "dir",
        path: "",
        children: entries.map((e) => ({
          name: e.name,
          type: e.type,
          path: e.name,
          children: [],
          loaded: false,
          loading: false,
        })),
        loaded: true,
        loading: false,
      };
      setTree(rootNode);
    } catch (e: any) {
      setError(`无法连接服务: ${e?.message ?? e}`);
    } finally {
      setLoadingTree(false);
    }
  }, []);

  useEffect(() => {
    checkServer();
  }, [checkServer]);

  useEffect(() => {
    if (serverOk) loadRoot();
  }, [serverOk, loadRoot]);

  /* ---- 更新树节点（不可变） ---- */
  const updateNode = useCallback(
    (root: TreeNode, targetPath: string, updater: (n: TreeNode) => TreeNode): TreeNode => {
      if (root.path === targetPath) return updater(root);
      return {
        ...root,
        children: root.children.map((c) => updateNode(c, targetPath, updater)),
      };
    },
    []
  );

  /* ---- 展开 / 收起目录（仅维护树结构，不加载右侧面板） ---- */
  const toggleExpand = useCallback(
    async (node: TreeNode) => {
      if (node.type !== "dir") return;

      const isExpanding = !expanded.has(node.path);

      setExpanded((prev) => {
        const next = new Set(prev);
        if (isExpanding) {
          next.add(node.path);
        } else {
          next.delete(node.path);
        }
        return next;
      });

      if (isExpanding && !node.loaded) {
        setTree((prev) =>
          prev ? updateNode(prev, node.path, (n) => ({ ...n, loading: true })) : prev
        );
        try {
          const res = await fetch(`${BASE}/ls_${encodePath(node.path)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const entries: DirEntry[] = await res.json();
          const children = entries.map((e) => ({
            name: e.name,
            type: e.type,
            path: node.path ? `${node.path}/${e.name}` : e.name,
            children: [] as TreeNode[],
            loaded: false,
            loading: false,
          }));
          setTree((prev) =>
            prev
              ? updateNode(prev, node.path, (n) => ({
                  ...n,
                  children,
                  loaded: true,
                  loading: false,
                }))
              : prev
          );
        } catch {
          setTree((prev) =>
            prev
              ? updateNode(prev, node.path, (n) => ({ ...n, loading: false }))
              : prev
          );
        }
      }
    },
    [expanded, updateNode]
  );

  /* ---- 加载右侧面板内容 ---- */
  const loadPanel = useCallback(
    async (itemPath: string, type: "dir" | "file") => {
      setSelectedPath(itemPath);
      setSelectedType(type);
      setCurrentPath(type === "dir" ? itemPath : itemPath.includes("/") ? itemPath.substring(0, itemPath.lastIndexOf("/")) : "");
      setFilterText("");

      if (type === "dir") {
        setLoadingDir(true);
        try {
          const res = await fetch(`${BASE}/ls_${encodePath(itemPath)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setDirEntries(await res.json());
        } catch (e: any) {
          setDirEntries([]);
          setError(`加载目录失败: ${e?.message ?? e}`);
        } finally {
          setLoadingDir(false);
        }
      } else {
        setLoadingContent(true);
        setFileContent("");
        try {
          const res = await fetch(`${BASE}/get_${encodePath(itemPath)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          // 后端返回 JSON（字符串会被 JSON 序列化加引号），用 .json() 解析
          let text: string;
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("json")) {
            text = await res.json();
          } else {
            text = await res.text();
          }
          setFileContent(text);
        } catch (e: any) {
          setFileContent("");
          setError(`读取文件失败: ${e?.message ?? e}`);
        } finally {
          setLoadingContent(false);
        }
      }
    },
    []
  );

  /* ---- 点击树节点 ---- */
  const handleTreeClick = useCallback(
    (node: TreeNode) => {
      if (node.type === "dir") {
        toggleExpand(node);
      }
      loadPanel(node.path, node.type);
    },
    [toggleExpand, loadPanel]
  );

  /* ---- 面包屑导航 ---- */
  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [{ label: ".qwenpaw", path: "" }];
    const parts = currentPath.split("/").filter(Boolean);
    const items = [{ label: ".qwenpaw", path: "" }];
    let acc = "";
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      items.push({ label: p, path: acc });
    }
    return items;
  }, [currentPath]);

  const handleBreadcrumbClick = useCallback(
    (path: string) => {
      loadPanel(path, "dir");
      // 确保树中对应节点被展开
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(path);
        return next;
      });
    },
    [loadPanel]
  );

  /* ---- 刷新 ---- */
  const handleRefresh = useCallback(async () => {
    setExpanded(new Set([""]));
    setSelectedPath("");
    setSelectedType(null);
    setDirEntries([]);
    setFileContent("");
    setFilterText("");
    setTree(null);
    await loadRoot();
  }, [loadRoot]);

  /* ---- 过滤目录条目 ---- */
  const filteredEntries = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return dirEntries;
    return dirEntries.filter((e) => e.name.toLowerCase().includes(q));
  }, [dirEntries, filterText]);

  /* ---- 折叠全部 ---- */
  const collapseAll = useCallback(() => {
    setExpanded(new Set([""]));
  }, []);

  /* ---- antd icon fallback ---- */
  const ReloadIcon = useMemo(
    () =>
      (antd as any).icons?.ReloadOutlined
        ? <antd.icons.ReloadOutlined />
        : <span style={{ fontSize: 14 }}>⟳</span>,
    []
  );

  /* ================================================================== */
  /*  Render                                                             */
  /* ================================================================== */

  /* ---- 连接失败 ---- */
  if (serverOk === false) {
    return (
      <Card style={{ margin: 16 }}>
        <Alert
          type="error"
          showIcon
          message="无法连接后端服务 (/api/serve_links)"
          description={
            <div>
              <p>请确认服务已启动。</p>
              <Button onClick={checkServer}>重试连接</Button>
            </div>
          }
        />
      </Card>
    );
  }

  /* ---- 检测中 ---- */
  if (serverOk === null) {
    return (
      <Card style={{ margin: 16 }}>
        <Spin /> 检测服务中…
      </Card>
    );
  }

  /* ---- 首次加载失败且无数据 ---- */
  if (error && !tree) {
    return (
      <Card style={{ margin: 16 }}>
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={
            <div>
              <p>{error}</p>
              <Button onClick={() => { setError(null); loadRoot(); }}>重试</Button>
            </div>
          }
        />
      </Card>
    );
  }

  /* ---- 主界面 ---- */
  return (
    <div id="fb-plugin-root">
      <style>{`
        #fb-plugin-root {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 80px);
          margin: 16px;
        }

        /* ---------- 左侧树 ---------- */
        #fb-plugin-root .fb-tree-box {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0;
        }
        #fb-plugin-root .fb-row {
          display: flex;
          align-items: center;
          padding: 3px 8px 3px 0;
          cursor: pointer;
          border-radius: 4px;
          margin: 0 4px;
          white-space: nowrap;
          user-select: none;
          font-size: 13px;
          color: #595959;
          line-height: 24px;
        }
        #fb-plugin-root .fb-row:hover {
          background: #f5f5f5;
        }
        #fb-plugin-root .fb-row.sel {
          background: #e6f4ff;
          color: #1677ff;
        }
        #fb-plugin-root .fb-arrow {
          width: 18px;
          text-align: center;
          font-size: 8px;
          color: #bfbfbf;
          flex-shrink: 0;
          transition: transform .15s ease;
        }
        #fb-plugin-root .fb-ico {
          margin-right: 5px;
          font-size: 14px;
          flex-shrink: 0;
        }
        #fb-plugin-root .fb-label {
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ---------- 右侧面板 ---------- */
        #fb-plugin-root .fb-rpanel {
          flex: 1;
          overflow: auto;
          background: #fff;
          position: relative;
        }
        #fb-plugin-root .fb-entry {
          display: flex;
          align-items: center;
          padding: 9px 16px;
          cursor: pointer;
          border-bottom: 1px solid #fafafa;
          transition: background .12s ease;
        }
        #fb-plugin-root .fb-entry:hover {
          background: #f5f5f5;
        }
        #fb-plugin-root .fb-entry.sel {
          background: #e6f4ff;
        }
        #fb-plugin-root .fb-entry-ico {
          margin-right: 10px;
          font-size: 18px;
          flex-shrink: 0;
        }
        #fb-plugin-root .fb-entry-name {
          font-size: 13.5px;
          color: #262626;
        }

        /* ---------- 文件内容 ---------- */
        #fb-plugin-root .fb-code {
          margin: 0;
          padding: 16px;
          font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
          font-size: 12.5px;
          line-height: 1.65;
          white-space: pre-wrap;
          word-break: break-all;
          color: #333;
          background: #fafafa;
          min-height: 100%;
          overflow: auto;
        }
      `}</style>

      {/* ================== Header ================== */}
      <Card
        size="small"
        style={{ borderRadius: "8px 8px 0 0", flexShrink: 0 }}
        styles={{ body: { padding: "10px 16px" } }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>📂 文件浏览器</span>
            <Breadcrumb
              items={breadcrumbs.map((b) => ({
                title: (
                  <a
                    key={b.path}
                    onClick={(e: any) => {
                      e.preventDefault();
                      handleBreadcrumbClick(b.path);
                    }}
                    style={{ fontSize: 13, cursor: "pointer" }}
                  >
                    {b.label}
                  </a>
                ),
              }))}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Tooltip title="折叠全部">
              <Button
                size="small"
                onClick={collapseAll}
                style={{ borderRadius: 6, fontSize: 12 }}
              >
                折叠
              </Button>
            </Tooltip>
            <Tooltip title="刷新">
              <Button
                size="small"
                icon={ReloadIcon}
                onClick={handleRefresh}
                style={{ borderRadius: 6 }}
              />
            </Tooltip>
          </div>
        </div>
      </Card>

      {/* ================== Body ================== */}
      <Card
        style={{
          flex: 1,
          borderRadius: "0 0 8px 8px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
        styles={{ body: { flex: 1, padding: 0, display: "flex", overflow: "hidden" } }}
      >
        {/* 浮动错误提示 */}
        {error && (
          <Alert
            type="warning"
            showIcon
            closable
            message={error}
            onClose={() => setError(null)}
            style={{
              position: "absolute",
              top: 8,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 10,
              borderRadius: 8,
              maxWidth: "60%",
            }}
          />
        )}

        {/* ---------- Left: Tree ---------- */}
        <div
          style={{
            width: 300,
            minWidth: 220,
            borderRight: "1px solid #f0f0f0",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
          }}
        >
          <div className="fb-tree-box">
            {loadingTree && !tree ? (
              <div style={{ textAlign: "center", padding: 32 }}>
                <Spin />
              </div>
            ) : tree ? (
              renderTreeNode(tree, 0, expanded, selectedPath, selectedType, handleTreeClick)
            ) : null}
          </div>
        </div>

        {/* ---------- Right: Content ---------- */}
        <div className="fb-rpanel">
          {!selectedPath && selectedType === null ? (
            /* ---- 空状态 ---- */
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "#bfbfbf",
                fontSize: 14,
              }}
            >
              {loadingTree ? <Spin /> : "选择左侧文件或目录以查看内容"}
            </div>
          ) : selectedType === "dir" ? (
            /* ---- 目录列表 ---- */
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div
                style={{
                  padding: "8px 16px",
                  borderBottom: "1px solid #f0f0f0",
                  background: "#fafafa",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 13, color: "#8c8c8c" }}>
                  {dirEntries.length} 个项目
                </span>
                <Input
                  size="small"
                  placeholder="过滤…"
                  allowClear
                  value={filterText}
                  onChange={(e: any) => setFilterText(e.target.value)}
                  style={{ width: 160 }}
                />
              </div>
              <div style={{ flex: 1, overflow: "auto" }}>
                {loadingDir ? (
                  <div style={{ textAlign: "center", padding: 32 }}>
                    <Spin />
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div style={{ padding: 32 }}>
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={dirEntries.length === 0 ? "空目录" : "无匹配项"}
                    />
                  </div>
                ) : (
                  <div>
                    {filteredEntries.map((entry) => {
                      const itemPath = currentPath
                        ? `${currentPath}/${entry.name}`
                        : entry.name;
                      const isSel =
                        selectedPath === itemPath && selectedType === entry.type;
                      return (
                        <div
                          key={`${entry.type}:${entry.name}`}
                          className={`fb-entry${isSel ? " sel" : ""}`}
                          onClick={() => loadPanel(itemPath, entry.type)}
                          onDoubleClick={() => {
                            if (entry.type === "dir") {
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                next.add(itemPath);
                                return next;
                              });
                            }
                          }}
                        >
                          <span className="fb-entry-ico">
                            {entry.type === "dir"
                              ? "📁"
                              : getFileIcon(entry.name)}
                          </span>
                          <span className="fb-entry-name">{entry.name}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ---- 文件内容 ---- */
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div
                style={{
                  padding: "8px 16px",
                  borderBottom: "1px solid #f0f0f0",
                  background: "#fafafa",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 16 }}>
                  {getFileIcon(selectedPath.split("/").pop() || "")}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#262626",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {selectedPath.split("/").pop()}
                </span>
                <span
                  style={{
                    display: "inline-block",
                    padding: "1px 8px",
                    background: "#f5f5f5",
                    borderRadius: 4,
                    fontSize: 11,
                    color: "#8c8c8c",
                  }}
                >
                  {getFileExt(selectedPath.split("/").pop() || "") || "file"}
                </span>
              </div>
              <div style={{ flex: 1, overflow: "auto" }}>
                {loadingContent ? (
                  <div style={{ textAlign: "center", padding: 48 }}>
                    <Spin size="large" />
                  </div>
                ) : fileContent === "unreadable format" ? (
                  <div style={{ padding: 32, textAlign: "center" }}>
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="无法读取此文件（二进制格式）"
                    />
                  </div>
                ) : fileContent === "" ? (
                  <div style={{ padding: 32, textAlign: "center" }}>
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="文件为空"
                    />
                  </div>
                ) : (
                  <pre className="fb-code">{fileContent}</pre>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tree renderer (recursive)                                          */
/* ------------------------------------------------------------------ */

function renderTreeNode(
  node: TreeNode,
  depth: number,
  expanded: Set<string>,
  selectedPath: string,
  selectedType: string | null,
  onClick: (n: TreeNode) => void
): any {
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path && selectedType === node.type;
  const indent = depth * 18;

  return (
    <div key={node.path || "__root__"}>
      <div
        className={`fb-row${isSelected ? " sel" : ""}`}
        style={{ paddingLeft: indent + 6 }}
        onClick={() => onClick(node)}
      >
        {/* 展开箭头 */}
        {node.type === "dir" ? (
          <span
            className="fb-arrow"
            style={{
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            ▶
          </span>
        ) : (
          <span className="fb-arrow" />
        )}
        {/* 图标 */}
        <span className="fb-ico">
          {node.type === "dir"
            ? isExpanded
              ? "📂"
              : "📁"
            : getFileIcon(node.name)}
        </span>
        {/* 名称 */}
        <span
          className="fb-label"
          style={{
            fontWeight: node.type === "dir" ? 500 : 400,
          }}
        >
          {node.name}
        </span>
        {/* 加载中指示 */}
        {node.loading && (
          <Spin size="small" style={{ marginLeft: 6, transform: "scale(0.7)" }} />
        )}
      </div>

      {/* 子节点 */}
      {node.type === "dir" && isExpanded && node.children.length > 0 && (
        <div>
          {/* 目录排前，文件排后 */}
          {[...node.children]
            .sort((a, b) => {
              if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
            .map((child) =>
              renderTreeNode(child, depth + 1, expanded, selectedPath, selectedType, onClick)
            )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  File icon mapping                                                  */
/* ------------------------------------------------------------------ */

function getFileIcon(name: string): string {
  const ext = getFileExt(name);
  const map: Record<string, string> = {
    json: "{ }",
    py: "🐍",
    ts: "TS",
    tsx: "TS",
    js: "JS",
    jsx: "JS",
    md: "📝",
    txt: "📄",
    html: "🌐",
    css: "🎨",
    yml: "⚙",
    yaml: "⚙",
    toml: "⚙",
    ini: "⚙",
    sh: "⌨",
    bat: "⌨",
    log: "📋",
    csv: "📊",
    xlsx: "📊",
    png: "🖼",
    jpg: "🖼",
    jpeg: "🖼",
    gif: "🖼",
    svg: "🖼",
    zip: "📦",
    rar: "📦",
    gz: "📦",
    tar: "📦",
    lock: "🔒",
  };
  return map[ext] || "📄";
}

/* ------------------------------------------------------------------ */
/*  Plugin registration                                                */
/* ------------------------------------------------------------------ */

class FileBrowserPlugin {
  readonly id = "frontend_file_browser";

  setup(): void {
    (window as any).QwenPaw.registerRoutes?.(this.id, [
      {
        path: "/plugin/frontend_file_browser/home",
        component: FileBrowser,
        label: "文件浏览器",
        icon: "📂",
        priority: 20,
      },
    ]);
  }
}

new FileBrowserPlugin().setup();
