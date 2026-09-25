import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ICONS = { router: '◉', switch: '▦', server: '▣', device: '▱' };

// 初始拓扑；routes 为静态路由：{ id, dest 目标网段, via 下一跳设备 ID, metric 度量值 }
const seed = {
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 220, ip: '10.0.0.1',
      routes: [
        { id: 'r1', dest: '10.0.1.0/24', via: 'sw1', metric: 10 },
        { id: 'rw', dest: '192.168.9.0/24', via: 'db', metric: 50 }, // 下一跳非直连：标红停用
      ] },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 370, ip: '10.0.1.1' },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 370, ip: '10.0.2.1' },
    { id: 'web', name: 'Web Server', type: 'server', x: 100, y: 520, ip: '10.0.1.10' },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 550, ip: '10.0.1.20' },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 530, ip: '10.0.2.22' },
  ],
  edges: [['gw', 'sw1'], ['gw', 'sw2'], ['sw1', 'web'], ['sw1', 'db'], ['sw2', 'user']],
};

const load = () => {
  try {
    return JSON.parse(localStorage.getItem('topology-v2')) || seed;
  } catch {
    return seed;
  }
};

// 两个设备之间是否有直接连线
const isDirectLink = (edges, a, b) =>
  edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

// 一条路由当前是否生效：下一跳设备存在且与本设备直连
const routeActive = (edges, ownerId, route) =>
  !!route.via && isDirectLink(edges, ownerId, route.via);

const validCidr = (v) =>
  /^(\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[12]\d|3[0-2])$/.test(v.trim());

const listDests = (dests) => dests.join('、');

function App() {
  const [data, setData] = useState(load);
  const [selected, setSelected] = useState('gw');
  const [tool, setTool] = useState('select');
  const [notice, setNotice] = useState('');
  const [drag, setDrag] = useState(null);
  const board = useRef();

  useEffect(() => localStorage.setItem('topology-v2', JSON.stringify(data)), [data]);

  const node = data.nodes.find((n) => n.id === selected) || data.nodes[0];

  const updateNode = (k, v) =>
    setData({ ...data, nodes: data.nodes.map((n) => (n.id === selected ? { ...n, [k]: v } : n)) });

  const addNode = () => {
    const id = 'node' + Date.now();
    setData({
      ...data,
      nodes: [...data.nodes, { id, name: '新设备', type: 'device', x: 500, y: 300, ip: '192.168.0.10' }],
    });
    setSelected(id);
    setTool('select');
    setNotice('已添加设备');
  };

  const connect = () => {
    if (!selected) return;
    const other = prompt('输入要连接的设备 ID（例如 sw1）');
    if (!other) return;
    if (!data.nodes.some((n) => n.id === other)) {
      setNotice(`连接失败：设备 ${other} 不存在`);
      return;
    }
    if (other === selected) {
      setNotice('连接失败：不能连接设备自身');
      return;
    }
    if (data.edges.some((e) => (e[0] === selected && e[1] === other) || (e[1] === selected && e[0] === other))) {
      setNotice('连接失败：两台设备之间已有连线');
      return;
    }
    setData({ ...data, edges: [...data.edges, [selected, other]] });
    setNotice('连接已创建');
  };

  // 收集“某台设备作为下一跳”的所有路由（不含被删除设备自身的路由）
  const routesPointingTo = (nodes, ownerId, viaId) =>
    nodes
      .filter((n) => n.id !== ownerId)
      .flatMap((n) => (n.routes || []).filter((r) => r.via === viaId).map((r) => r.dest));

  const remove = () => {
    if (!node) return;
    // 其它设备上指向被删设备的路由随之失效
    const affected = routesPointingTo(data.nodes, node.id, node.id);
    setData({
      ...data,
      nodes: data.nodes
        .filter((n) => n.id !== node.id)
        .map((n) => ({
          ...n,
          routes: (n.routes || []).map((r) =>
            r.via === node.id ? { ...r, via: '' } : r
          ),
        })),
      edges: data.edges.filter((e) => !e.includes(node.id)),
    });
    setSelected(data.nodes.find((n) => n.id !== node.id)?.id);
    setNotice(
      affected.length
        ? `设备已删除，${affected.length} 条路由失效，受影响目标网段：${listDests(affected)}`
        : '设备已删除'
    );
  };

  // 断开连线：两端互指对方的静态路由全部失效，列出受影响目标网段
  const disconnect = (a, b) => {
    const affected = data.nodes.flatMap((n) =>
      n.id === a || n.id === b
        ? (n.routes || []).filter((r) => r.via === (n.id === a ? b : a)).map((r) => r.dest)
        : []
    );
    setData({ ...data, edges: data.edges.filter((e) => !isDirectLink([e], a, b)) });
    setNotice(
      affected.length
        ? `连线已断开，${affected.length} 条路由失效，受影响目标网段：${listDests(affected)}`
        : '连线已断开'
    );
  };

  const save = () => setNotice('拓扑图已保存');

  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'network-topology.json';
    a.click();
    setNotice('JSON 已导出');
  };

  const validate = () => {
    const linked = new Set(data.edges.flat());
    const isolated = data.nodes.filter((n) => !linked.has(n.id));
    const down = data.nodes.flatMap((n) =>
      (n.routes || []).filter((r) => !routeActive(data.edges, n.id, r)).map((r) => ({ owner: n, route: r }))
    );
    const parts = [];
    parts.push(isolated.length ? `发现 ${isolated.length} 个孤立节点` : '没有孤立节点');
    parts.push(down.length ? `${down.length} 条静态路由已停用（标红）` : '静态路由全部生效');
    setNotice('拓扑检查：' + parts.join('，'));
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

  // ---- 静态路由表单 ----
  const neighbors = useMemo(
    () =>
      node
        ? data.nodes.filter((n) =>
            data.edges.some((e) => (e[0] === node.id && e[1] === n.id) || (e[1] === node.id && e[0] === n.id))
          )
        : [],
    [node, data.nodes, data.edges]
  );

  const [dest, setDest] = useState('');
  const [via, setVia] = useState('');
  const [metric, setMetric] = useState(10);

  useEffect(() => {
    setDest('');
    setMetric(10);
    setVia(neighbors[0]?.id || '');
  }, [selected, neighbors.length]);

  const addRoute = () => {
    const d = dest.trim();
    if (!validCidr(d)) {
      setNotice('请填写合法目标网段，例如 10.0.1.0/24');
      return;
    }
    const m = Number(metric);
    if (!Number.isInteger(m) || m < 0 || m > 65535) {
      setNotice('度量值需为 0–65535 之间的整数');
      return;
    }
    if (!via) {
      setNotice('请选择下一跳设备');
      return;
    }
    const routes = node.routes || [];
    const existed = routes.find((r) => r.dest === d);
    // 同一目标网段只保留一条生效路由：重复登记即覆盖（更新下一跳与度量值）
    const nextRoutes = existed
      ? routes.map((r) => (r.dest === d ? { ...r, via, metric: m } : r))
      : [...routes, { id: 'r' + Date.now(), dest: d, via, metric: m }];
    setData({
      ...data,
      nodes: data.nodes.map((n) => (n.id === node.id ? { ...n, routes: nextRoutes } : n)),
    });
    setDest('');
    setMetric(10);
    setNotice(
      existed
        ? `目标网段 ${d} 已存在，已更新该路由（下一跳/度量值）`
        : isDirectLink(data.edges, node.id, via)
          ? `静态路由已添加：${d} 经由直连设备转发`
          : `静态路由已添加，但下一跳非直连，${d} 已标红停用`
    );
  };

  const removeRoute = (rid) => {
    const removed = (node.routes || []).find((r) => r.id === rid);
    setData({
      ...data,
      nodes: data.nodes.map((n) =>
        n.id === node.id ? { ...n, routes: (n.routes || []).filter((r) => r.id !== rid) } : n
      ),
    });
    setNotice(removed ? `已移除路由 ${removed.dest}` : '已移除路由');
  };

  const routesView = useMemo(
    () =>
      node
        ? (node.routes || []).map((r) => ({
            ...r,
            active: routeActive(data.edges, node.id, r),
            nextHop: data.nodes.find((n) => n.id === r.via),
          }))
        : [],
    [node, data.nodes, data.edges]
  );

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
          <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')}>↖ 选择</button>
          <button className={tool === 'connect' ? 'on' : ''} onClick={() => { setTool('connect'); connect(); }}>⌁ 连接</button>
          <button onClick={addNode}>＋ 设备</button>
        </div>
        <div className="tool-group zoom">
          <button>−</button><span>100%</span><button>＋</button>
          <button onClick={() => setNotice('画布已居中')}>⌗</button>
        </div>
      </div>
      <div className="workspace">
        <aside className="inventory">
          <div className="section-title"><span>设备库</span><small>{data.nodes.length} 个节点</small></div>
          <div className="device-types">
            {[['router', '◉', '路由器'], ['switch', '▦', '交换机'], ['server', '▣', '服务器'], ['device', '▱', '终端设备']].map(([t, i, l]) => (
              <button
                onClick={() => {
                  const id = 'node' + Date.now();
                  setData({ ...data, nodes: [...data.nodes, { id, name: l, type: t, x: 500, y: 320, ip: '192.168.0.2' }] });
                  setSelected(id);
                }}
                key={t}
              >
                <i className={t}>{i}</i>{l}<span>＋</span>
              </button>
            ))}
          </div>
          <div className="section-title nodes-head"><span>图中节点</span><small>点击查看</small></div>
          <div className="node-list">
            {data.nodes.map((n) => (
              <button className={selected === n.id ? 'sel' : ''} onClick={() => setSelected(n.id)} key={n.id}>
                <i className={n.type}>{ICONS[n.type]}</i>
                <span><strong>{n.name}</strong><small>{n.ip}</small></span>
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
              const dx = n2.x - n1.x, dy = n2.y - n1.y;
              const len = Math.hypot(dx, dy);
              const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
              return (
                <div className="edge" key={i} style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}>
                  <span></span>
                </div>
              );
            })}
            {data.nodes.map((n) => (
              <button
                className={'node ' + n.type + (selected === n.id ? ' picked' : '')}
                style={{ left: n.x - 42, top: n.y - 31 }}
                onMouseDown={(e) => { e.stopPropagation(); setSelected(n.id); setDrag(n.id); }}
                onClick={() => setSelected(n.id)}
                key={n.id}
              >
                <i>{ICONS[n.type]}</i>
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
            <span>拖动节点调整位置 · {data.edges.length} 条连接</span>
            <span>坐标系：画布局部</span>
          </div>
        </section>
        <aside className="inspector">
          <div className="section-title"><span>属性</span><small>{node?.type}</small></div>
          {node ? (
            <>
              <label>设备名称
                <input value={node.name} onChange={(e) => updateNode('name', e.target.value)} />
              </label>
              <label>IP 地址
                <input value={node.ip} onChange={(e) => updateNode('ip', e.target.value)} />
              </label>
              <label>设备类型
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

              {node.type === 'router' && (
                <div className="routes">
                  <div className="section-title routes-head">
                    <span>静态路由</span>
                    <small>{routesView.length} 条 · {routesView.filter((r) => r.active).length} 生效</small>
                  </div>

                  {routesView.length === 0 && <p className="route-empty">暂无静态路由，请在下方登记</p>}
                  {routesView.map((r) => (
                    <div className={'route' + (r.active ? '' : ' down')} key={r.id}>
                      <div className="route-top">
                        <b>{r.dest}</b>
                        <span className={'badge ' + (r.active ? 'up' : 'off')}>
                          {r.active ? '生效中' : '已停用'}
                        </span>
                      </div>
                      <div className="route-meta">
                        <span>下一跳 {r.nextHop ? r.nextHop.name : '（设备已移除）'}</span>
                        {!r.active && <em>{r.nextHop ? '下一跳非直连' : '下一跳设备已移除'}</em>}
                      </div>
                      <div className="route-meta">
                        <span>度量值 {r.metric}</span>
                        <button className="route-del" onClick={() => removeRoute(r.id)}>移除</button>
                      </div>
                    </div>
                  ))}

                  <div className="route-form">
                    <label>目标网段
                      <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="10.0.1.0/24" />
                    </label>
                    <label>下一跳
                      <select value={via} onChange={(e) => setVia(e.target.value)}>
                        {data.nodes.filter((n) => n.id !== node.id).map((n) => (
                          <option value={n.id} key={n.id}>
                            {n.name}（{n.id}）{isDirectLink(data.edges, node.id, n.id) ? '' : ' · 非直连'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>度量值
                      <input type="number" min="0" max="65535" value={metric}
                        onChange={(e) => setMetric(e.target.value)} />
                    </label>
                    <button className="route-add" onClick={addRoute}>登记静态路由</button>
                    <p className="route-hint">同目标网段仅保留一条；下一跳须为直连设备，否则标红停用。</p>
                  </div>
                </div>
              )}

              <div className="connections">
                <div className="section-title"><span>连接</span><small>{data.edges.filter((e) => e.includes(node.id)).length} 条</small></div>
                {data.edges.filter((e) => e.includes(node.id)).map((e, i) => {
                  const other = data.nodes.find((n) => n.id === (e[0] === node.id ? e[1] : e[0]));
                  return (
                    <div className="connection" key={i}>
                      <span className={'mini ' + other?.type}></span>
                      <strong>{other?.name}</strong>
                      <small>在线</small>
                      <button className="conn-cut" title="断开连线"
                        onClick={() => disconnect(node.id, other.id)}>✕</button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : <p>选择一个设备</p>}
        </aside>
      </div>
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
