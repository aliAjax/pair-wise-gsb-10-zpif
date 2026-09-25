import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ICON = { router: '◉', switch: '▦', server: '▣', device: '▱' };

const seed = {
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 220, ip: '10.0.0.1' },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 370, ip: '10.0.1.1' },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 370, ip: '10.0.2.1' },
    { id: 'web', name: 'Web Server', type: 'server', x: 100, y: 520, ip: '10.0.1.10' },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 550, ip: '10.0.1.20' },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 530, ip: '10.0.2.22' },
  ],
  edges: [['gw', 'sw1'], ['gw', 'sw2'], ['sw1', 'web'], ['sw1', 'db'], ['sw2', 'user']],
  routes: [
    { id: 'rt-seed-1', node: 'gw', dest: '10.0.1.0/24', via: 'sw1', metric: 10 },
    { id: 'rt-seed-2', node: 'gw', dest: '10.0.2.0/24', via: 'sw2', metric: 20 },
  ],
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem('topology'));
    if (!saved) return seed;
    // 兼容没有 routes 字段的旧存档
    return {
      nodes: saved.nodes || seed.nodes,
      edges: saved.edges || seed.edges,
      routes: Array.isArray(saved.routes) ? saved.routes : [],
    };
  } catch {
    return seed;
  }
}

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 校验 IPv4/prefix 形式的目标网段，如 10.0.1.0/24
function isValidCidr(v) {
  if (!/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(v)) return false;
  const [ip, prefix] = v.split('/');
  const octets = ip.split('.').map(Number);
  if (octets.some((o) => o > 255)) return false;
  const p = Number(prefix);
  return p >= 0 && p <= 32;
}

function App() {
  const [data, setData] = useState(load);
  const [selected, setSelected] = useState('gw');
  const [tool, setTool] = useState('select');
  const [notice, setNotice] = useState(null); // { title, lines }
  const [drag, setDrag] = useState(null);
  // 静态路由表单
  const [rDest, setRDest] = useState('');
  const [rVia, setRVia] = useState('');
  const [rMetric, setRMetric] = useState('10');
  const [editingRoute, setEditingRoute] = useState(null);
  const board = useRef();

  useEffect(() => {
    localStorage.setItem('topology', JSON.stringify(data));
  }, [data]);

  // 切换设备时复位路由表单
  useEffect(() => {
    setEditingRoute(null);
    setRDest('');
    setRVia('');
    setRMetric('10');
  }, [selected]);

  const node = data.nodes.find((n) => n.id === selected) || data.nodes[0];

  const nodeById = useMemo(
    () => Object.fromEntries(data.nodes.map((n) => [n.id, n])),
    [data.nodes]
  );

  // 直连邻接表：下一跳必须在这里面路由才生效
  const neighbors = useMemo(() => {
    const m = {};
    data.nodes.forEach((n) => (m[n.id] = new Set()));
    data.edges.forEach(([a, b]) => {
      m[a]?.add(b);
      m[b]?.add(a);
    });
    return m;
  }, [data.nodes, data.edges]);

  const myRoutes = useMemo(
    () => data.routes.filter((r) => r.node === selected),
    [data.routes, selected]
  );

  // 路由状态：下一跳设备存在且与本机直连才生效，否则标红停用
  const routeState = (r) => {
    if (!nodeById[r.node]) return { cls: 'down', label: '停用', reason: '所属设备已移除' };
    if (!nodeById[r.via]) return { cls: 'down', label: '停用', reason: '下一跳设备已移除' };
    if (!neighbors[r.node]?.has(r.via))
      return { cls: 'down', label: '停用', reason: '下一跳不是直连设备' };
    return { cls: 'active', label: '生效', reason: '' };
  };

  const flash = (title, lines = []) =>
    setNotice({ title, lines: [...new Set(lines)].filter(Boolean) });

  const updateNode = (k, v) =>
    setData({ ...data, nodes: data.nodes.map((n) => (n.id === selected ? { ...n, [k]: v } : n)) });

  const addNode = () => {
    const id = uid('node');
    const n = { id, name: '新设备', type: 'device', x: 500, y: 300, ip: '192.168.0.10' };
    setData({ ...data, nodes: [...data.nodes, n] });
    setSelected(id);
    setTool('select');
    flash('已添加设备');
  };

  const addTypedNode = (type, label) => {
    const id = uid('node');
    setData({
      ...data,
      nodes: [...data.nodes, { id, name: label, type, x: 500, y: 320, ip: '192.168.0.2' }],
    });
    setSelected(id);
  };

  const connect = () => {
    if (!selected) return;
    const other = prompt('输入要连接的设备 ID（例如 sw1）');
    if (!other) return;
    if (!data.nodes.some((n) => n.id === other)) {
      flash(`未找到设备：${other}`);
      return;
    }
    if (other === selected) {
      flash('不能连接设备自身');
      return;
    }
    if (
      data.edges.some(
        (e) => (e[0] === selected && e[1] === other) || (e[1] === selected && e[0] === other)
      )
    ) {
      flash('两台设备已经直连');
      return;
    }
    // 重新连上后，之前因断线停用的路由会自动恢复生效
    const restored = data.routes
      .filter(
        (r) =>
          (r.node === selected && r.via === other) || (r.node === other && r.via === selected)
      )
      .map((r) => r.dest);
    setData({ ...data, edges: [...data.edges, [selected, other]] });
    flash(
      restored.length ? '连接已创建，以下目标网段的路由恢复生效：' : '连接已创建',
      restored
    );
  };

  // 断开连线：经对端做下一跳的路由全部失效，列出受影响目标网段
  const disconnect = (otherId) => {
    const affected = data.routes
      .filter(
        (r) =>
          (r.node === selected && r.via === otherId) ||
          (r.node === otherId && r.via === selected)
      )
      .map((r) => r.dest);
    setData({
      ...data,
      edges: data.edges.filter(
        (e) =>
          !((e[0] === selected && e[1] === otherId) || (e[1] === selected && e[0] === otherId))
      ),
    });
    flash(
      affected.length
        ? '连接已断开，以下目标网段的静态路由失效：'
        : '连接已断开，无受影响的静态路由',
      affected
    );
  };

  // 移除设备：指向它（以它为下一跳）的路由标红停用，并列出受影响目标网段
  const remove = () => {
    if (!node) return;
    const id = node.id;
    const affected = data.routes.filter((r) => r.via === id).map((r) => r.dest);
    const next = data.nodes.find((n) => n.id !== id);
    setData({
      ...data,
      nodes: data.nodes.filter((n) => n.id !== id),
      edges: data.edges.filter((e) => !e.includes(id)),
      // 只清理随设备一起消失的本机路由；指向被删设备的路由保留并标红，便于管理员处理
      routes: data.routes.filter((r) => r.node !== id),
    });
    setSelected(next?.id);
    flash(
      affected.length ? '设备已移除，指向它的静态路由失效：' : '设备已移除',
      affected
    );
  };

  const save = () => flash('拓扑图已保存');

  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    );
    a.download = 'network-topology.json';
    a.click();
    flash('JSON 已导出');
  };

  const validate = () => {
    const linked = new Set(data.edges.flat());
    const isolated = data.nodes.filter((n) => !linked.has(n.id)).map((n) => n.name);
    const down = data.routes.filter((r) => routeState(r).cls === 'down');
    const lines = [];
    if (isolated.length) lines.push('孤立节点：' + isolated.join('、'));
    if (down.length)
      lines.push(
        '停用路由：' +
          down
            .map((r) => `${r.dest}（${nodeById[r.node]?.name || r.node} 上登记）`)
            .join('、')
      );
    setNotice(
      lines.length
        ? { title: '拓扑检查发现问题：', lines }
        : { title: '拓扑检查通过：没有孤立节点，静态路由全部生效', lines: [] }
    );
  };

  const editRoute = (r) => {
    setEditingRoute(r.id);
    setRDest(r.dest);
    setRVia(r.via);
    setRMetric(String(r.metric));
  };

  const cancelEdit = () => {
    setEditingRoute(null);
    setRDest('');
    setRVia('');
    setRMetric('10');
  };

  const deleteRoute = (id) => {
    setData({ ...data, routes: data.routes.filter((r) => r.id !== id) });
    flash('静态路由已删除');
  };

  const submitRoute = (e) => {
    e.preventDefault();
    const dest = rDest.trim();
    const metric = parseInt(rMetric, 10);
    if (!isValidCidr(dest)) {
      flash('目标网段格式不正确，示例：10.0.1.0/24');
      return;
    }
    if (!rVia) {
      flash('请选择下一跳设备');
      return;
    }
    if (!Number.isInteger(metric) || metric < 0 || metric > 65535) {
      flash('度量值需为 0–65535 之间的整数');
      return;
    }
    // 同一设备的同一目标网段只能保留一条生效路由
    const dup = data.routes.some(
      (r) => r.node === selected && r.dest === dest && r.id !== editingRoute
    );
    if (dup) {
      flash(`已存在到 ${dest} 的路由：同一设备同一目标网段仅保留一条，请编辑或删除原路由`);
      return;
    }
    const direct = neighbors[selected]?.has(rVia);
    if (editingRoute) {
      setData({
        ...data,
        routes: data.routes.map((r) =>
          r.id === editingRoute ? { ...r, dest, via: rVia, metric } : r
        ),
      });
      flash(direct ? '静态路由已更新并生效' : '静态路由已更新，但下一跳非直连，已标红停用');
    } else {
      setData({
        ...data,
        routes: [...data.routes, { id: uid('rt'), node: selected, dest, via: rVia, metric }],
      });
      flash(direct ? '路由已登记并生效' : '路由已登记，但下一跳不是直连设备，已标红停用');
    }
    cancelEdit();
  };

  const move = (e) => {
    if (!drag) return;
    const r = board.current.getBoundingClientRect();
    setData({
      ...data,
      nodes: data.nodes.map((n) =>
        n.id === drag
          ? { ...n, x: Math.max(35, e.clientX - r.left), y: Math.max(35, e.clientY - r.top) }
          : n
      ),
    });
  };

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <div>
            <strong>NETSCAPE</strong>
            <small>TOPOLOGY STUDIO</small>
          </div>
        </div>
        <div className="file">
          <span className="dot"></span>
          <div>
            <strong>office-network.json</strong>
            <small>最近保存：刚刚</small>
          </div>
        </div>
        <div className="top-actions">
          <button onClick={validate}>✓ 检查</button>
          <button onClick={exportJson}>↓ 导出</button>
          <button className="save" onClick={save}>保存更改</button>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <span>工具</span>
          <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')}>
            ↖ 选择
          </button>
          <button
            className={tool === 'connect' ? 'on' : ''}
            onClick={() => {
              setTool('connect');
              connect();
            }}
          >
            ⌁ 连接
          </button>
          <button onClick={addNode}>＋ 设备</button>
        </div>
        <div className="tool-group zoom">
          <button>−</button>
          <span>100%</span>
          <button>＋</button>
          <button onClick={() => flash('画布已居中')}>⌗</button>
        </div>
      </div>

      <div className="workspace">
        <aside className="inventory">
          <div className="section-title">
            <span>设备库</span>
            <small>{data.nodes.length} 个节点</small>
          </div>
          <div className="device-types">
            {[
              ['router', '◉', '路由器'],
              ['switch', '▦', '交换机'],
              ['server', '▣', '服务器'],
              ['device', '▱', '终端设备'],
            ].map(([t, i, l]) => (
              <button onClick={() => addTypedNode(t, l)} key={t}>
                <i className={t}>{i}</i>
                {l}
                <span>＋</span>
              </button>
            ))}
          </div>
          <div className="section-title nodes-head">
            <span>图中节点</span>
            <small>点击查看</small>
          </div>
          <div className="node-list">
            {data.nodes.map((n) => (
              <button
                className={selected === n.id ? 'sel' : ''}
                onClick={() => setSelected(n.id)}
                key={n.id}
              >
                <i className={n.type}>{ICON[n.type]}</i>
                <span>
                  <strong>{n.name}</strong>
                  <small>{n.ip}</small>
                </span>
                <b>›</b>
              </button>
            ))}
          </div>
        </aside>

        <section className="canvas-wrap">
          <div className="canvas" ref={board} onMouseMove={move} onMouseUp={() => setDrag(null)}>
            {data.edges.map(([a, b], i) => {
              const n1 = data.nodes.find((n) => n.id === a);
              const n2 = data.nodes.find((n) => n.id === b);
              if (!n1 || !n2) return null;
              const dx = n2.x - n1.x;
              const dy = n2.y - n1.y;
              const len = Math.hypot(dx, dy);
              const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
              return (
                <div
                  className="edge"
                  key={i}
                  style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}
                >
                  <span></span>
                </div>
              );
            })}
            {data.nodes.map((n) => (
              <button
                className={'node ' + n.type + (selected === n.id ? ' picked' : '')}
                style={{ left: n.x - 42, top: n.y - 31 }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setSelected(n.id);
                  setDrag(n.id);
                }}
                onClick={() => setSelected(n.id)}
                key={n.id}
              >
                <i>{ICON[n.type]}</i>
                <strong>{n.name}</strong>
                <small>{n.ip}</small>
              </button>
            ))}
            <div className="legend">
              <span><i className="router"></i>路由器</span>
              <span><i className="switch"></i>交换机</span>
              <span><i className="server"></i>服务器</span>
            </div>
          </div>
          <div className="canvas-footer">
            <span>拖动节点调整位置 · {data.edges.length} 条连接 · {data.routes.length} 条静态路由</span>
            <span>坐标系：画布局部</span>
          </div>
        </section>

        <aside className="inspector">
          <div className="section-title">
            <span>属性</span>
            <small>{node?.type}</small>
          </div>
          {node ? (
            <>
              <label>
                设备名称
                <input value={node.name} onChange={(e) => updateNode('name', e.target.value)} />
              </label>
              <label>
                IP 地址
                <input value={node.ip} onChange={(e) => updateNode('ip', e.target.value)} />
              </label>
              <label>
                设备类型
                <select value={node.type} onChange={(e) => updateNode('type', e.target.value)}>
                  <option value="router">路由器</option>
                  <option value="switch">交换机</option>
                  <option value="server">服务器</option>
                  <option value="device">终端设备</option>
                </select>
              </label>
              <div className="inspector-actions">
                <button onClick={connect}>⌁ 添加连接</button>
                <button className="danger" onClick={remove}>删除设备</button>
              </div>

              <div className="connections">
                <div className="section-title">
                  <span>连接</span>
                  <small>{data.edges.filter((e) => e.includes(node.id)).length} 条</small>
                </div>
                {data.edges
                  .filter((e) => e.includes(node.id))
                  .map((e, i) => {
                    const other = data.nodes.find(
                      (n) => n.id === (e[0] === node.id ? e[1] : e[0])
                    );
                    return (
                      <div className="connection" key={i}>
                        <span className={'mini ' + other?.type}></span>
                        <strong>{other?.name}</strong>
                        <small>在线</small>
                        <button
                          className="cut"
                          title="断开连接"
                          onClick={() => disconnect(other.id)}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
              </div>

              <div className="routes">
                <div className="section-title">
                  <span>静态路由</span>
                  <small>{myRoutes.length} 条</small>
                </div>
                {myRoutes.length === 0 && <p className="empty-hint">暂无静态路由，在下方登记</p>}
                {myRoutes.map((r) => {
                  const st = routeState(r);
                  const hop = nodeById[r.via];
                  return (
                    <div className={'route-item ' + st.cls} key={r.id}>
                      <div className="route-head">
                        <strong>{r.dest}</strong>
                        <span className={'badge ' + st.cls}>{st.label}</span>
                      </div>
                      <div className="route-meta">
                        <span>
                          下一跳 {hop ? `${hop.name} · ${hop.ip}` : `设备已移除（${r.via}）`}
                        </span>
                        <span>度量 {r.metric}</span>
                      </div>
                      {st.cls === 'down' && <small className="route-reason">{st.reason}</small>}
                      <div className="route-ops">
                        <button onClick={() => editRoute(r)}>编辑</button>
                        <button onClick={() => deleteRoute(r.id)}>删除</button>
                      </div>
                    </div>
                  );
                })}

                <form className="route-form" onSubmit={submitRoute}>
                  <label>
                    目标网段
                    <input
                      value={rDest}
                      onChange={(e) => setRDest(e.target.value)}
                      placeholder="例如 10.0.1.0/24"
                    />
                  </label>
                  <label>
                    下一跳
                    <select value={rVia} onChange={(e) => setRVia(e.target.value)}>
                      <option value="">选择设备…</option>
                      {data.nodes
                        .filter((n) => n.id !== selected)
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}（{n.ip}）
                            {neighbors[selected]?.has(n.id) ? '' : ' · 非直连'}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    度量值
                    <input
                      type="number"
                      min="0"
                      max="65535"
                      value={rMetric}
                      onChange={(e) => setRMetric(e.target.value)}
                    />
                  </label>
                  <div className="route-form-actions">
                    <button type="submit" className="primary">
                      {editingRoute ? '保存修改' : '登记路由'}
                    </button>
                    {editingRoute && (
                      <button type="button" onClick={cancelEdit}>
                        取消
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </>
          ) : (
            <p>选择一个设备</p>
          )}
        </aside>
      </div>

      {notice && (
        <div className="toast">
          <strong>{notice.title}</strong>
          {notice.lines?.length > 0 && (
            <ul>
              {notice.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
