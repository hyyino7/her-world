// Native DSH settings registration follows the pinned DSH settings slot contract.
// Browser factory/entry structure follows dsh-dafeiyu-dot (MIT; see notices).
window.__ModuleLoader__.load({
  id: 'her-world',
  factory(require) {
    'use strict';
    const React = require('react');
    const h = React.createElement;
    const details = (title, ...children) => h('details', { className: 'cp-details' }, h('summary', null, title), ...children);
    const { useState, useRef, useId } = React;
    const sections = [
      ['overview', '概览'], ['role', '角色'], ['emotion', '情绪'], ['archive', '记忆与档案'],
      ['desktop', '桌宠'], ['life', '生活'], ['connections', '连接'], ['workspace', '工作区'],
    ];
    const worldGroups = [
      { id: 'persona', title: '人设与提示', modules: { persona: '人设提示', scope: '工作区范围' },
        connection: '角色页预览绑定工作区的角色和用户资料。' },
      { id: 'conversation', title: '对话与记忆', modules: { history: '近期历史', archive: '对话归档', memory: '记忆查询', compaction: '批量整理' },
        connection: '记忆与档案页显示 DSH 工作区关联的会话数，并提供搜索和精读。续聊沿用 DSH 历史。' },
      { id: 'expression', title: '心情与表达', modules: { mood: '心情状态' },
        connection: '情绪页读取当前心情和可用动作、贴图。' },
      { id: 'life', title: '生活与接入', modules: { life: '自主生活', reflection: '日记与反思', photos: '长期相册',
        bridge: '主动消息', channels: '渠道路由', qq: 'QQ', wechat: '微信' },
        connection: '生活页提供作息、活动、日记和相册；连接页管理聊天渠道。' },
      { id: 'activity', title: '运行与用量', modules: { health: '健康与故障', usage: '活动与用量' },
        connection: '当前服务状态见上方。活动日志在生活页；准确用量见对应 DSH 会话。' },
    ];
    const workspaceLabels = { unbound: '未绑定', pending: '待初始化', ready: '已就绪', unavailable: '不可用' };
    const capabilityLabels = { ready: '可用', degraded: '部分可用', unavailable: '不可用', disabled: '已停用',
      initializing: '初始化中', not_implemented: '待接入', incompatible: '版本不兼容', stopping: '正在停用' };
    const memoryProviderLabels = { ready: '已连接', stopped: '未运行，按需启动', unresolved: '状态待确认' };
    const memoryKeys = ['memorySummaryTurns', 'memorySummaryIdleMinutes', 'memorySummaryMinimumMinutes', 'memoryRecallCount', 'memoryRecallBlockChars'];
    const css = `
      .chatpet-settings { --cp-gold:#c49a52; --cp-glow:color-mix(in srgb,var(--cp-gold) 22%,transparent); --cp-soft:var(--dsw-alias-label-tertiary,#8b8475); --cp-serif:'Noto Serif SC','Source Han Serif SC','Songti SC','STSong','SimSun',serif; font-size:13px; line-height:1.65; container-type: inline-size; color: inherit; width: 100%; max-width: 780px; min-width: 0; margin-inline: auto; padding: 4px 0 20px; }
      .chatpet-settings * { box-sizing: border-box; }
      .chatpet-settings h2 { font-size: 22px; margin: 0 0 8px; font-weight: 650; }
      .chatpet-settings h3 { font:600 14px var(--cp-serif); letter-spacing:.12em; margin:0; }
      .chatpet-settings .cp-card-head h3:before {content:'';display:inline-block;width:14px;height:1px;background:var(--cp-gold);vertical-align:middle;margin-right:8px;}
      .chatpet-settings p { margin: 6px 0 0; line-height: 1.65; font-size: 13px; }
      .chatpet-settings .cp-muted { opacity: .64; }
      .chatpet-settings .cp-heading { display:flex; gap:16px; align-items:center; justify-content:space-between; margin-bottom:18px; padding:18px 20px; border:1px solid color-mix(in srgb,currentColor 13%,transparent); border-radius:14px; background:radial-gradient(120% 140% at 100% 0%,var(--cp-glow),transparent 55%),color-mix(in srgb,currentColor 3.5%,transparent); }
      .chatpet-settings .cp-heading h2 {font:600 24px/1.25 var(--cp-serif);letter-spacing:.04em;margin:2px 0 5px;}
      .chatpet-settings .cp-heading small {font-size:10px;letter-spacing:.22em;color:var(--cp-soft);}
      .chatpet-settings .cp-state {font-size:12px;color:var(--cp-soft);display:flex;align-items:center;gap:7px;}
      .chatpet-settings .cp-dot {width:7px;height:7px;border-radius:50%;background:var(--cp-gold);display:inline-block;}
      .chatpet-settings .cp-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}
      .chatpet-settings .cp-grid .cp-card {margin:0;}
      .chatpet-settings .cp-foundation {min-height:340px;font-family:ui-monospace,monospace;font-size:12px;line-height:1.7;}
      .chatpet-settings .cp-appearance {min-width:0;overflow-wrap:anywhere;--dsw-alias-state-business-primary:var(--cp-gold);--dsw-alias-button-info-fill:var(--cp-gold);--dsw-alias-button-info-hover:color-mix(in srgb,var(--cp-gold) 92%,black);--dsw-alias-border-l2:color-mix(in srgb,currentColor 14%,transparent);}
      .chatpet-settings .cp-appearance .dsh-pet-cfg {max-width:none!important;}
      .chatpet-settings .cp-appearance .dsh-pet-cfg__card {border-color:color-mix(in srgb,currentColor 14%,transparent);background:color-mix(in srgb,currentColor 3.5%,transparent);}
      .chatpet-settings .cp-appearance .dsh-pet-cfg__title {font:600 16px var(--cp-serif);letter-spacing:.1em;}
      .chatpet-settings .cp-desktop-panel {display:flex;flex-direction:column;}
      .chatpet-settings .cp-desktop-panel > * {order:2;}
      .chatpet-settings .cp-desktop-panel > .cp-card:first-child {order:0;}
      .chatpet-settings .cp-desktop-panel > .cp-migration-panel {order:0;}
      .chatpet-settings .cp-desktop-panel > .cp-appearance {order:1;margin-bottom:14px;}
      .chatpet-settings .cp-migration + .cp-migration {border-top:1px solid color-mix(in srgb,currentColor 14%,transparent);padding-top:8px;}
      .chatpet-settings .cp-big {font:600 22px/1.3 var(--cp-serif);margin:4px 0 8px;}
      .chatpet-settings .cp-emotion {border-left:2px solid var(--cp-gold);padding-left:12px;}
      .chatpet-settings .cp-badge { display: inline-flex; flex: 0 0 auto; border: 1px solid color-mix(in srgb,currentColor 20%,transparent); border-radius: 20px; padding: 3px 9px; font-size: 11px; line-height: 1.5; }
      .chatpet-settings .cp-tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid color-mix(in srgb,currentColor 15%,transparent); margin-bottom: 20px; }
      .chatpet-settings .cp-tab { font:500 13px var(--cp-serif); letter-spacing:.1em; font-size: 13px; color: inherit; padding: 10px 12px; background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; opacity: .64; }
      .chatpet-settings .cp-tab[aria-selected=true] { opacity: 1; border-bottom-color: var(--cp-gold); font-weight: 600; }
      .chatpet-settings :focus-visible { outline: 2px solid currentColor; outline-offset: 3px; border-radius: 3px; }
      .chatpet-settings .cp-card { border: 1px solid color-mix(in srgb,currentColor 14%,transparent); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; background:color-mix(in srgb,currentColor 3.5%,transparent); }
      .chatpet-settings .cp-card-head { display: flex; justify-content: space-between; align-items: start; gap: 12px; margin-bottom: 15px; }
      .chatpet-settings .cp-fields { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16px; }
      .chatpet-settings .cp-field { display: flex; flex-direction: column; gap: 7px; font-size: 13px; min-width: 0; }
      .chatpet-settings .cp-wide { grid-column: 1 / -1; }
      .chatpet-settings input, .chatpet-settings textarea, .chatpet-settings select { width: 100%; font: inherit; color: inherit; background: color-mix(in srgb,currentColor 3%,transparent); border: 1px solid color-mix(in srgb,currentColor 16%,transparent); border-radius: 7px; padding: 9px 10px; }
      .chatpet-settings .cp-switch { display:flex; align-items:center; gap:8px; font-size:13px; line-height:1.6; }
      .chatpet-settings input[type=checkbox] { width:auto; flex:0 0 auto; padding:0; }
      .chatpet-settings textarea { min-height: 94px; resize: vertical; }
      .chatpet-settings :disabled { cursor: not-allowed; opacity: .55; }
      .chatpet-settings .cp-field small { font-size: 12px; line-height: 1.6; opacity: .64; }
      .chatpet-settings .cp-card p { overflow-wrap:anywhere; }
      .chatpet-settings .cp-hero { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start; gap:16px; padding:22px; background:color-mix(in srgb,currentColor 4%,transparent); }
      .chatpet-settings .cp-hero small { display:block; margin-bottom:4px; font-size:12px; opacity:.72; }
      .chatpet-settings .cp-hero h3 { font-size:26px; line-height:1.25; overflow-wrap:anywhere; }
      .chatpet-settings .cp-hero-actions { grid-column:1/-1; display:flex; flex-wrap:wrap; gap:8px; }
      .chatpet-settings .cp-overview-row { display:grid; grid-template-columns:minmax(6em,auto) 1fr auto; align-items:center; gap:10px; padding:12px 0; font-size:13px; }
      .chatpet-settings .cp-overview-row + .cp-overview-row { border-top:1px solid color-mix(in srgb,currentColor 12%,transparent); }
      .chatpet-settings .cp-row-value { min-width:0; overflow-wrap:anywhere; }
      .chatpet-settings .cp-row-value small { display:block; margin-top:3px; opacity:.75; }
      .chatpet-settings .cp-preview { white-space:pre-wrap; overflow-wrap:anywhere; max-height:15em; overflow:auto; margin:6px 0 14px; padding:12px; border-radius:7px; background:color-mix(in srgb,currentColor 5%,transparent); font:inherit; font-size:13px; line-height:1.6; }
      .chatpet-settings .cp-inline-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
      .chatpet-settings .cp-card h4 { margin:14px 0 4px; font-size:13px; }
      .chatpet-settings .cp-world-adoption { padding:12px 0; border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent); }
      .chatpet-settings .cp-world-adoption h4 { font-size:13px; margin:0; }
      .chatpet-settings .cp-status-list dd { overflow-wrap:anywhere; min-width:0; }
      .chatpet-settings .cp-results { list-style:none; margin:10px 0; padding:0; }
      .chatpet-settings .cp-results button { width:100%; text-align:start; overflow-wrap:anywhere; margin:3px 0; }
      .chatpet-settings .cp-details { border-top:1px solid color-mix(in srgb,currentColor 14%,transparent); padding:14px 0; }
      .chatpet-settings .cp-details > summary { font-size:14px; font-weight:600; cursor:pointer; }
      .chatpet-settings .cp-details[open] > summary { margin-bottom:16px; }
      .chatpet-settings .cp-status-list { display:grid; grid-template-columns:minmax(5em,auto) 1fr; gap:8px 16px; font-size:13px; margin:10px 0; }
      .chatpet-settings .cp-status-list dd { margin:0; }
      .chatpet-settings .cp-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-top: 1px solid color-mix(in srgb,currentColor 14%,transparent); padding-top: 16px; margin-top: 22px; }
      .chatpet-settings button:not(.cp-tab):not([class]) {border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:7px;padding:7px 12px;background:transparent;color:inherit;font:inherit;cursor:pointer;margin:5px 6px 5px 0;}
      .chatpet-settings .cp-save { flex: 0 0 auto; border: 1px solid color-mix(in srgb,currentColor 20%,transparent); color: inherit; background: transparent; padding: 8px 14px; border-radius: 7px; font: inherit; font-size: 13px; }
      .chatpet-settings .cp-card > p + .cp-save { margin-top:12px; }
      .chatpet-settings .cp-save:enabled { cursor:pointer; }
      .chatpet-settings .cp-save:enabled:hover { background:color-mix(in srgb,currentColor 7%,transparent); }
      .chatpet-settings .cp-primary:enabled { background:var(--cp-gold); border-color:var(--cp-gold); color:#fffaf0; }
      .chatpet-settings .cp-primary:enabled:hover { background:var(--cp-gold); filter:brightness(.95); }
      @media(prefers-reduced-motion:reduce) {.chatpet-settings * {animation:none!important;transition:none!important;}}
      @container(max-width:560px) { .chatpet-settings .cp-grid {grid-template-columns:1fr;}  .chatpet-settings .cp-fields { grid-template-columns: 1fr; } .chatpet-settings .cp-card { padding: 14px; } .chatpet-settings .cp-tab { padding: 9px 8px; } .chatpet-settings .cp-footer { align-items: start; } .chatpet-settings .cp-overview-row { grid-template-columns:minmax(5em,auto) 1fr; } .chatpet-settings .cp-overview-row .cp-save { grid-column:2; justify-self:start; } }
    `;
    const badge = (text = '待接入') => h('span', { className: 'cp-badge' }, text);
    function Field({ label, note, wide, multiline, value, onChange, type = 'text', min, max, step, maxLength, disabled }) {
      const id = useId();
      return h('div', { className: `cp-field${wide ? ' cp-wide' : ''}` },
        h('label', { htmlFor: id }, label),
        h(multiline ? 'textarea' : 'input', { id, type: multiline ? undefined : type, value: value ?? '', min, max, step, maxLength, disabled,
          onChange: event => onChange(event.target.value), 'aria-describedby': note ? `${id}-note` : undefined }),
        note && h('small', { id: `${id}-note` }, note));
    }
    function Card({ id, title, note, children, status }) {
      return h('section', { className: 'cp-card', id, tabIndex: id ? -1 : undefined, 'aria-label': id ? title : undefined },
        h('div', { className: 'cp-card-head' }, h('div', null, h('h3', null, title), note && h('p', { className: 'cp-muted' }, note)), status && badge(status)), children);
    }
    const fields = (...children) => h('div', { className: 'cp-fields' }, ...children);
    const field = (label, options = {}) => h(Field, { key: label, label, ...options });
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const facts = rows => h('dl', { className: 'cp-status-list' }, ...rows.map(([label, value]) =>
      h(React.Fragment, { key: label }, h('dt', null, label), h('dd', null, value))));
    const preview = (label, text) => h(React.Fragment, null, h('h4', null, label),
      h('pre', { className: 'cp-preview', tabIndex: 0 }, text || '尚未填写'));

    // Each task mounts its reader on demand. Unbinding, switching tasks and refreshing
    // unmount it and abort the request before any previous workspace data can reappear.
    function WorkspaceView({ workspaceId, section, request, revision, children }) {
      const [attempt, setAttempt] = useState(0);
      const [result, setResult] = useState(null);
      React.useEffect(() => {
        if (!workspaceId) return;
        const controller = new AbortController();
        async function loadView() {
          try {
            const value = await request('worldView', { workspaceId, section }, controller.signal);
            if (value.workspaceId !== workspaceId) throw new Error('工作区已切换，请刷新设置。');
            if (!controller.signal.aborted) setResult({ revision, attempt, workspaceId, section, value });
          } catch (error) {
            if (!controller.signal.aborted) setResult({ revision, attempt, workspaceId, section, error: error.message });
          }
        }
        void loadView();
        return () => controller.abort();
      }, [workspaceId, section, revision, attempt, request]);
      if (!workspaceId) return h('p', { className: 'cp-muted' }, '请先绑定并初始化工作区。');
      if (!result || result.workspaceId !== workspaceId || result.section !== section || result.revision !== revision || result.attempt !== attempt)
        return h('p', { role: 'status' }, '正在读取工作区资料…');
      if (result.error) return h(React.Fragment, null, h('p', { role: 'alert' }, result.error),
        h('button', { type: 'button', className: 'cp-save', onClick: () => setAttempt(n => n + 1) }, '重试读取'));
      return children(result.value);
    }

    function ArchiveSearch({ workspaceId, request }) {
      const [query, setQuery] = useState('');
      const [found, setFound] = useState(null);
      const [detail, setDetail] = useState(null);
      const [pending, setPending] = useState('');
      const [error, setError] = useState('');
      const flight = useRef(null);
      React.useEffect(() => () => flight.current?.abort(), []);
      function clear() {
        flight.current?.abort();
        setPending(''); setError(''); setFound(null); setDetail(null);
      }
      async function lookup(id) {
        flight.current?.abort();
        const controller = new AbortController(); flight.current = controller;
        setPending(id ? 'detail' : 'find'); setError(''); setDetail(null);
        if (!id) setFound(null);
        try {
          const value = id
            ? await request('archiveRead', { workspaceId, memoryId: id }, controller.signal)
            : await request('archiveFind', { workspaceId, query: query.trim() }, controller.signal);
          if (controller.signal.aborted) return;
          if (id) {
            setDetail(value);
            setFound(null);
          } else setFound(value);
        } catch (failure) {
          if (controller.signal.aborted) return;
          // All excerpts came from the same eligibility read. Invalidate them on a
          // failed drill-down so a since-withdrawn or corrected excerpt cannot linger.
          setFound(null); setDetail(null); setError(failure.message);
        } finally { if (!controller.signal.aborted) setPending(''); }
      }
      return h(Card, { title: '档案检索', note: '按关键词查找当前工作区已收录的对话或记忆。打开结果可查看详情和关联原文。' },
        h('form', { onSubmit: event => { event.preventDefault(); if (query.trim() && pending !== 'find') void lookup(); } },
          field('查找已收录的对话或记忆', { type: 'search', maxLength: 240, value: query, onChange: value => { clear(); setQuery(value); } }),
          h('div', { className: 'cp-inline-actions' }, h('button', { type: 'submit', className: 'cp-save cp-primary',
            disabled: !query.trim() || pending === 'find' }, '搜索档案'))),
        pending && h('p', { role: 'status' }, pending === 'find' ? '正在查找…' : '正在读取详情…'),
        error && h('p', { role: 'alert' }, error),
        found && (found.items.length ? h(React.Fragment, null,
          h('p', { role: 'status' }, '找到 ' + found.items.length + ' 条，本次最多返回 ' + found.limit + ' 条。'),
          h('ul', { className: 'cp-results' }, ...found.items.map(item => h('li', { key: item.id },
            h('button', { type: 'button', className: 'cp-save', onClick: () => void lookup(item.id) }, item.excerpt || '查看记忆详情')))))
          : h('p', { role: 'status' }, '没有找到匹配的已收录内容。')),
        detail && h('section', { 'aria-label': '记忆详情' }, h('h4', null, '记忆详情'),
          h('pre', { className: 'cp-preview', tabIndex: 0 }, detail.content),
          detail.dialogue.length > 0 && h('details', { className: 'cp-details' }, h('summary', null, '关联对话原文'),
            ...detail.dialogue.map((turn, index) => h('div', { key: index },
              preview(({ user: '用户', assistant: '大肥鱼', source: '来源' })[turn.role] || '来源', turn.text))))));
    }
    function RoomView({workspaceId, request}) {
      const [busy,setBusy] = useState(false), [error,setError] = useState('');
      const lifetime = useRef(null);
      React.useEffect(() => {const c=new AbortController();lifetime.current=c;return()=>c.abort();}, [workspaceId]);
      async function open() {
        const signal=lifetime.current.signal;setBusy(true);setError('');
        try {await request('roomOpen',{workspaceId},signal);}
        catch(e) {if(!signal.aborted)setError(e.message);}
        finally {if(!signal.aborted)setBusy(false);}
      }
      return h(Card,{title:'房间与菜园',note:'在独立窗口里陪它聊天、照顾生活或看看菜园。'},
        h('button',{type:'button',className:'cp-save',disabled:busy||!workspaceId,onClick:open},busy?'正在打开…':'打开房间'),
        error&&h('p',{role:'alert'},error));
    }
    function QQGroup({workspaceId, groupId, request}) {
      const [view,setView] = useState(null), [edit,setEdit] = useState(null), [word,setWord] = useState(''), [meaning,setMeaning] = useState('');
      const [research,setResearch] = useState(null), [fault,setFault] = useState(''), [busy,setBusy] = useState(false);
      const lifetime = useRef(null);
      React.useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
      async function change(op,input = {}) {
        const signal = lifetime.current.signal;
        try {
          setBusy(true); setFault('');
          const call = (operation,data) => request(operation,{workspaceId,groupId,...data},signal);
          const result = await call(op,input);
          if (signal.aborted) return;
          if (op === 'groupResearch') { setResearch(result); return; }
          const next = op === 'groupState' ? result : await call('groupState',{});
          if (!signal.aborted) { setView(next); setEdit(next.settings); }
        } catch (error) { if (!signal.aborted) setFault(error.message); }
        finally { if (!signal.aborted) setBusy(false); }
      }
      const button = (label, click, disabled = false) => h('button',{type:'button',disabled:busy || disabled,onClick:click},label);
      const choose = item => { setWord(item.content); setMeaning(item.meaning || ''); setResearch(null); };
      return details('群 ' + groupId, button('读取群资料',()=>change('groupState')), fault && h('p',{role:'alert'},fault),
        edit && h('div',null,
          ...Object.entries({affinity:'成员好感',slang:'群用语',stickers:'群贴图',forwards:'合并转发'}).map(([k,label]) =>
            h('label',{key:k,className:'cp-switch'},h('input',{type:'checkbox',checked:edit[k],onChange:e=>setEdit({...edit,[k]:e.target.checked})}),label)),
          h('label',{className:'cp-field'},'本群公开角色卡',h('textarea',{value:edit.roleCard,onChange:e=>setEdit({...edit,roleCard:e.target.value})})),
          h('label',{className:'cp-field'},'群聊模式',h('select',{value:edit.roleMode,onChange:e=>setEdit({...edit,roleMode:e.target.value})},
            h('option',{value:'v1'},'V1'),h('option',{value:'v2'},'V2'))),
          edit.roleMode === 'v2' && edit.wake && h('div',{className:'cp-fields'},
            ...Object.entries({anyMessage:'任意消息可唤醒',atMention:'群友提及时唤醒',nameMention:'叫名字时唤醒',question:'听到提问可唤醒',
              keywords:'唤醒关键词（每行一个）',speakerIds:'唤醒发言人 ID（每行一个）',probability:'唤醒概率',maxPerMinute:'每分钟最多唤醒次数',maxPerHour:'每小时最多唤醒次数'})
              .map(([key,label])=>{
                const value=edit.wake[key], set=value=>setEdit({...edit,wake:{...edit.wake,[key]:value}});
                if (typeof value === 'boolean') return h('label',{key,className:'cp-switch'},h('input',{type:'checkbox',checked:value,onChange:e=>set(e.target.checked)}),label);
                if (Array.isArray(value)) return h('label',{key,className:'cp-field'},label,h('textarea',{value:value.join('\n'),onChange:e=>set(e.target.value.split('\n'))}));
                return h('label',{key,className:'cp-field'},label,h('input',{type:'number',min:0,step:'any',value:value??'',onChange:e=>set(Number(e.target.value))}));
              })),
          view.social && edit.roleMode === 'v2' && h('p',null,'未读 ' + view.social.unread + ' · ' + (view.social.lastWakeReason || '尚未唤醒') + ' · ' + (view.social.lastFeedback || '')),
          view.social?.reports?.length > 0 && details('本群观察报告',
            ...view.social.reports.slice(-10).reverse().map((report,index) => h('p',{key:index},
              new Date(report.at).toLocaleString() + ' · ' + ({info:'记录',warning:'提醒',error:'异常'}[report.level] || '记录') + ' · ' + report.message))),
          button('保存本群设置',()=>change('groupSettings',{expected:view.settings,next:edit})),
          h('h4',null,'成员好感'), ...(view.affinity || []).map((a,i)=>h('p',{key:i},(a.name || a.userId) + ' · ' + a.score)),
          ...(view.impressions || []).map(member=>h('p',{key:member.speakerId},(member.name || member.speakerId) + ' · ' +
            (Array.isArray(member.traits) ? member.traits.join('、') : member.traits))),
          h('h4',null,'群贴图'), ...(view.stickers || []).map((s,i)=>h('p',{key:i},s.label || s.name || s.id)),
          h('h4',null,'群用语'), ...(view.slang || []).map(item=>h('button',{key:item.content,type:'button',onClick:()=>choose(item)},item.content)),
          h('label',{className:'cp-field'},'词语',h('input',{value:word,onChange:e=>{setWord(e.target.value); setResearch(null);}})),
          h('label',{className:'cp-field'},'在本群的含义',h('input',{value:meaning,onChange:e=>setMeaning(e.target.value)})),
          ...[['candidate','记为候选'],['confirmed','确认含义'],['rejected','不采用']].map(([status,label]) =>
            h(React.Fragment,{key:status},button(label,()=>change('groupSlang',{content:word,meaning,usage:'',status}),!word.trim()))),
          button('查询公开用法',()=>change('groupResearch',{content:word}),!view.slang?.some(i=>i.content===word && i.status==='candidate')),
          research && h('section',null,h('p',null,research.message || '公开查询结果'),
            ...(research.sources || []).map(item=>h('p',{key:item.url},item.title + ' · ' + item.snippet)))));
    }
    function Qzone({workspaceId,request}) {
      const [view,setView] = useState(null), [edit,setEdit] = useState(null),[draft,setDraft] = useState('');
      const [busy,setBusy] = useState(false), [error,setError] = useState(''), lifetime = useRef(null);
      React.useEffect(()=>{const c=new AbortController(); lifetime.current=c; return ()=>c.abort();},[]);
      const update = async (name,input={}) => {
        const signal=lifetime.current.signal; setBusy(true); setError('');
        try {
          const call=(op,data)=>request(op,{workspaceId,...data},signal);
          const result=await call(name,input);
          const current=name==='qzoneState'?result:await call('qzoneState',{});
          if (!signal.aborted) { setView(current); setEdit(current.settings); if (name==='qzoneDraft') setDraft(''); }
        } catch(e) {if (!signal.aborted) setError(e.message);}
        finally {if (!signal.aborted) setBusy(false);}
      };
      const button=(label,fn,disabled=false)=>h('button',{type:'button',disabled:disabled||busy,onClick:fn},label);
      return details('QQ 空间',button('查看空间发布计划',()=>update('qzoneState')),error && h('p',{role:'alert'},error),
        edit && h('div',null,
          h('label',{className:'cp-switch'},h('input',{type:'checkbox',checked:edit.enabled,onChange:e=>setEdit({...edit,enabled:e.target.checked})}),'定时公开发布已排队的草稿'),
          h('label',{className:'cp-field'},'北京时间（每行一个，24 小时制）',h('textarea',{value:edit.times.join('\n'),onChange:e=>setEdit({...edit,times:e.target.value.split('\n')})})),
          h('label',{className:'cp-field'},'每日最多发布条数',h('input',{type:'number',min:1,value:edit.dailyMax,onChange:e=>setEdit({...edit,dailyMax:Number(e.target.value)})})),
          button('保存发布计划',()=>update('qzoneSettings',{expected:view.settings,next:{...edit,times:edit.times.map(a=>a.trim()).filter(Boolean)}})),
          h('label',{className:'cp-field'},'允许定时公开发布的正文',h('textarea',{value:draft,onChange:e=>setDraft(e.target.value)})),
          button('加入公开发布队列',()=>update('qzoneDraft',{text:draft.trim()}),!draft.trim()),
          ...(view.drafts||[]).map(item=>h('div',{key:item.id},h('p',null,item.text + ' · ' + item.status),
            ['pending','queued'].includes(item.status) && button('移除草稿',()=>update('qzoneRemove',{id:item.id})))),
          ...(view.posts||[]).map((post,i)=>h('p',{key:post.id || i},new Date(post.at).toLocaleString() + ' · ' + post.status))));
    }
    function ChannelsPage({workspaceId, request}) {
      const [saved, setSaved] = useState(null), [draft, setDraft] = useState(null), [busy,setBusy] = useState(false);
      const [fault,setFault] = useState(''), lifetime = useRef(null);
      React.useEffect(() => { const c = new AbortController(); lifetime.current = c; return () => c.abort(); }, [workspaceId,request]);
      async function change(operation, input) {
        setBusy(true); setFault('');
        const signal = lifetime.current.signal,submitted=draft;
        try { const result = await request(operation, {workspaceId,...input}, signal);
          if (!signal.aborted) {
            setSaved(result);
            setDraft(old=>{
              const received={bridge:result.bridge.preferences,...result.messaging.config};
              if(!old)return received;
              const next={...old},groups=operation==='channelStatus'?Object.keys(received):operation==='bridgeSettings'?['bridge']:Object.keys(input.next??{});
              // Acknowledge only submitted sections that have not been edited
              // again while the save awaited its native owner.
              for(const group of groups)if(equal(old[group],submitted?.[group]))next[group]=received[group];
              return next;
            });
          }
        } catch (e) { if (!signal.aborted) setFault(e.message); }
        finally { if (!signal.aborted) setBusy(false); }
      }
      const button = (label, action) => h('button', {type:'button', disabled:busy, onClick:action}, label);
      const set = (group,key,value) => setDraft(old => ({...old,[group]:{...old[group],[key]:value}}));
      function control(group,{key,label,kind,options}) {
        const value = draft[group][key];
        if (kind === 'boolean') return h('label', {className:'cp-switch',key}, h('input', {type:'checkbox', checked:value,
          onChange:e => set(group,key,e.target.checked)}), label);
        if (kind === 'lines') return h('label', {className:'cp-field',key}, label, h('textarea', {value:value.join('\n'),
          onChange:e => set(group,key,e.target.value.split('\n'))}));
        if (kind === 'select') return h('label',{className:'cp-field',key},label,h('select',{value,onChange:e=>set(group,key,e.target.value)},
          ...Object.entries(options).map(([value,label])=>h('option',{key:value,value},label))));
        return h('label', {className:'cp-field',key}, label, h('input', {value:value ?? '', type:kind,
          onChange:e => set(group,key,kind === 'number' ? Number(e.target.value) : e.target.value)}));
      }
      function platform(group, name) {
        const config = draft[group], status = saved.messaging[group];
        if (!config) return null;
        const fields = saved.messaging.fields[group];
        return details(name, h('div',null,
          status && h('p',null, [status.state || status.account || (config.enabled ? '等待连接' : '已关闭'),
            status.error, Number.isFinite(status.pending ?? status.outbox) ? '待发 ' + (status.pending ?? status.outbox) : '',
            Number.isFinite(status.sent) ? '已发 ' + status.sent : '', Number.isFinite(status.failed) ? '失败 ' + status.failed : '',
            Number.isFinite(status.uncertain) ? '待核对 ' + status.uncertain : ''].filter(Boolean).join(' · ')),
          status?.usage && h('p',null,'本账号模型调用 ' + status.usage.requests + ' 次 · 输入 ' + status.usage.inputTokens +
            ' / 输出 ' + status.usage.outputTokens + ' tokens · 缓存读取 ' + status.usage.cacheReadTokens +
            (status.usage.unreported ? ' · 未返回用量 ' + status.usage.unreported + ' 次' : '')),
          Number.isFinite(status?.voiceReceived) && h('p',null,'收到语音 ' + status.voiceReceived + ' · 送达已核对 ' +
            status.voiceVerified + ' · 待核对 ' + status.voiceUncertain),
          status?.path && h('p',null,'本机微信适配器连接文件：' + status.path),
          h('div',{className:'cp-fields'},...fields.map(field=>control(group,field))),
          button('保存' + name + '设置', ()=>change('messagingSettings',{expected:saved.messaging.config,next:{[group]:Object.fromEntries(
            fields.map(({key,kind})=>[key,kind === 'lines' ? config[key].map(x=>x.trim()).filter(Boolean) : config[key]]))}}))));
      }
      const updateOutlet = (i,key,value) => set('bridge','outlets',draft.bridge.outlets.map((o,j)=>i===j ? {...o,[key]:value} : o));
      return h(Card, {title:'外部联络'}, fault && h('p',{role:'alert'},fault),
        button(saved ? '重新读取渠道状态（放弃未保存修改）' : '管理渠道', ()=>change('channelStatus',{})),
        draft && h(React.Fragment,null,platform('qq','QQ'),platform('wechat','微信'),
          saved.messaging.config.qq.accountId && h(Qzone,{key:saved.messaging.config.qq.accountId,workspaceId,request}),
          ...saved.messaging.config.qq.allowGroups.map(groupId=>h(QQGroup,{key:groupId,groupId,workspaceId,request})),
          details('本地程序和推送', h('div',null, control('bridge',{key:'enabled',kind:'boolean',label:'允许本机受信程序给生活会话发消息'}),
            saved.bridge.discovery && h('p',null,'本机连接资料保存在 ' + saved.bridge.discovery),
            ...draft.bridge.outlets.map((o,i)=>h('div',{key:i,className:'cp-fields'},
              h('label',{className:'cp-field'},'接收端名称',h('input',{value:o.name,onChange:e=>updateOutlet(i,'name',e.target.value)})),
              h('label',{className:'cp-field'},'推送地址',h('input',{type:'url',value:o.url,onChange:e=>updateOutlet(i,'url',e.target.value)})),
              ...[['reach','主动消息'],['reply','桥接回复'],['busy','忙碌提醒']].map(([k,l])=>h('label',{key:k,className:'cp-switch'},
                h('input',{type:'checkbox',checked:o.kinds.includes(k),onChange:e=>updateOutlet(i,'kinds',e.target.checked ? [...o.kinds,k] : o.kinds.filter(x=>x!==k))}),l)),
              button('移除接收端',()=>set('bridge','outlets',draft.bridge.outlets.filter((_,j)=>i!==j))))),
            button('添加接收端',()=>set('bridge','outlets',[...draft.bridge.outlets,{name:'',url:'',kinds:['reach','reply','busy']}])),
            button('保存桥接设置',()=>change('bridgeSettings',{expected:saved.bridge.preferences,next:draft.bridge}))))));
    }
    function CompanionArchive({workspaceId, request, companionName}) {
      const [dates, setDates] = useState(null), [entry, setEntry] = useState(null);
      const [album, setAlbum] = useState(null), [image, setImage] = useState(null);
      const [fault, setFault] = useState(''), [busy, setBusy] = useState(false);
      const [query, setQuery] = useState(''), [result, setResult] = useState(null);
      const lifetime = useRef(null);
      React.useEffect(() => {
        const controller = new AbortController(); lifetime.current = controller;
        return () => controller.abort();
      }, [workspaceId]);
      async function read(operation) {
        const signal = lifetime.current.signal;
        setBusy(true); setFault('');
        try {
          const call = (endpoint, args = {}) => request(endpoint, {workspaceId, ...args}, signal);
          const update = await operation(call);
          if (!signal.aborted) update();
        } catch (e) { if (!signal.aborted) setFault(e.message); }
        finally { if (!signal.aborted) setBusy(false); }
      }
      const button = (label, run) => h('button', {type:'button', disabled:busy, onClick:() => read(run)}, label);
      const page = offset => async call => {
        const result = await call('lifeAlbum', {offset});
        return () => { setAlbum(result); setImage(null); };
      };
      const search = offset => async call => {
        const term = offset ? result.query : query.trim();
        if (!term) throw Error('请输入关键词');
        const found = await call('lifeSearch', {query:term, offset});
        return () => setResult({query:term, diaries:offset ? result.diaries : found.diaries,
          lines:[...(offset ? result.lines : []), ...(found.dialogue?.items || [])], next:found.dialogue?.nextOffset});
      };
      return h(Card, {title:'日记与相册'},
        fault && h('p', {role:'alert'}, fault),
        h('label', {className:'cp-field'}, '查找聊天原文和日记', h('input', {value:query, maxLength:256, onChange:e => setQuery(e.target.value)})),
        button('查找', search(0)),
        result && h('div', null, ...result.diaries.map(item => h('p', {key:item.date}, item.date + ' · ' + item.excerpt)),
          ...result.lines.map(line => h('p', {key:line.id}, new Date(line.time).toLocaleString() + ' · ' + (line.role === 'user' ? '用户' : companionName || '伙伴') + ' · ' + line.text)),
          !result.diaries.length && !result.lines.length && h('p', null, '没有查到可读取的记录。'),
          result.next !== undefined && button('继续查看聊天原文', search(result.next))),
        button('翻日记和活动', async call => { const days = await call('lifeDates'); return () => setDates(days); }),
        dates && h('div', {className:'cp-inline-actions'}, dates.length ? dates.map(day => h(React.Fragment, {key:day},
          button(day, async call => { const result = await call('lifeJournal', {day}); return () => setEntry(result); }))) : '还没有日记或活动。'),
        entry && h('section', null, h('h4', null, entry.day), h('p', {style:{whiteSpace:'pre-wrap'}}, entry.diary || '当天没有可显示的日记。'),
          ...entry.activity.map((event, i) => h('p', {key:i}, new Date(event.time).toLocaleTimeString() + ' · ' + event.summary))),
        button('打开相册', page(0)),
        album && h('section', null, album.total ? h('p', null, '已收藏 ' + album.total + ' 张') : h('p', null, '相册还没有照片。可以在普通聊天中请伙伴收藏收到的图片。'),
          ...album.photos.map(photo => h('div', {key:photo.id}, button(photo.description || new Date(photo.savedAt).toLocaleString(), async call => {
            const result = await call('lifePhoto', {id:photo.id});
            return () => setImage({id:photo.id, title:photo.description, src:'data:' + result.mediaType + ';base64,' + result.data});
          }))),
          album.offset > 0 && button('上一页', page(Math.max(0, album.offset - album.limit))),
          album.hasMore && button('下一页', page(album.offset + album.limit))),
        image && h('figure', null, h('img', {src:image.src, alt:image.title || '收藏的照片', style:{maxWidth:'100%',maxHeight:'55vh'}}),
          button('移出相册', async call => {
            await call('lifeForgetPhoto', {id:image.id});
            return page(0)(call);
          })));
    }
    function EconomyPanel({workspaceId, request}) {
      const [view,setView] = useState(null), [busy,setBusy] = useState(false), [fault,setFault] = useState('');
      const [feedback,setFeedback] = useState(''), [edit,setEdit] = useState(null), [pending,setPending] = useState(null);
      const [amount,setAmount] = useState(''), [note,setNote] = useState('');
      const [giftItem,setGiftItem] = useState(''), [giftQuantity,setGiftQuantity] = useState('1'), [giftNote,setGiftNote] = useState('');
      const [feedItem,setFeedItem] = useState('');
      const [imported,setImported] = useState(null), [title,setTitle] = useState('');
      const [readingFormat,setReadingFormat] = useState('article');
      const lifetime = useRef(null), locked = useRef(false), unresolved = useRef(null);
      const storageKey = `chatpet:economy:pending:${workspaceId}`;
      React.useEffect(() => {
        const controller = new AbortController(); lifetime.current = controller;
        setView(null); setEdit(null); setImported(null); setTitle(''); setAmount(''); setNote(''); setFault('');
        try {
          const saved = localStorage.getItem(storageKey), value = saved ? JSON.parse(saved) : null;
          if (value && (typeof value.requestId !== 'string' || !['economyAction','economySettings'].includes(value.endpoint)
            || value.input?.workspaceId !== workspaceId)) throw Error('待确认经济操作的本机记录无效，请先检查浏览器保存状态。');
          unresolved.current = value; setPending(value);
        } catch (error) { unresolved.current = {invalid:true}; setPending({invalid:true}); setFault(error.message); }
        async function load() {
          try { const next = await request('economyView',{workspaceId},controller.signal); if (!controller.signal.aborted) setView(next); }
          catch(error) { if (!controller.signal.aborted) setFault(error.message); }
        }
        void load();
        return () => controller.abort();
      },[workspaceId,request,storageKey]);
      const refresh = async () => {
        const signal=lifetime.current.signal; setFault('');
        try {const next=await request('economyView',{workspaceId},signal); if(!signal.aborted)setView(next);}
        catch(error){if(!signal.aborted)setFault(error.message);}
      };
      async function send(operation) {
        if (locked.current || unresolved.current?.invalid) return;
        const signal=lifetime.current.signal; locked.current=true;setBusy(true);setFault('');setFeedback('');
        try {
          if (!unresolved.current) {
            localStorage.setItem(storageKey,JSON.stringify(operation));
            unresolved.current=operation;setPending(operation);
          } else if (unresolved.current.requestId!==operation.requestId) throw Error('有一笔结果待确认的操作，请先重试或核对流水。');
          const result=await request(operation.endpoint,operation.input,signal,operation.requestId);
          if(result.execution && !['completed','failed','cancelled'].includes(result.execution.status)) {
            if(!signal.aborted){setPending(operation);setFeedback('投喂仍在等待核对，请重试原操作或查看使用中的库存。');await refresh();}
            return;
          }
          // Only an acknowledged receipt releases the durable request identity.
          localStorage.removeItem(storageKey);unresolved.current=null;
          if(signal.aborted)return;
          setPending(null);setFeedback(result.execution?.status==='failed'?'投喂未完成，请查看原因与库存。':'已保存，可在流水中核对。');setEdit(null);
          if(operation.input.action?.kind==='grant'){setAmount('');setNote('');}
          if(operation.input.action?.kind==='importReading'){setImported(null);setTitle('');}
          await refresh();
          if(result.execution?.status==='failed'&&!signal.aborted)setFault(result.execution.reason||'本次投喂未完成。');
        } catch(error){if(!signal.aborted){
          // These domain refusals occur before any commit. A transport timeout,
          // cancellation, binding change or unknown error keeps the original ID.
          if(['INELIGIBLE','NOT_FOUND','STALE_REVISION'].includes(error.code)) {
            localStorage.removeItem(storageKey);unresolved.current=null;setPending(null);
          }
          setFault(error.message);
        }}
        finally{locked.current=false;if(!signal.aborted)setBusy(false);}
      }
      const mutate=(endpoint,input)=>send({endpoint,input:{workspaceId,...input},requestId:crypto.randomUUID()});
      const act=action=>mutate('economyAction',{action});
      const button=(label,onClick,disabled=false)=>h('button',{type:'button',className:'cp-save',disabled:busy||disabled,onClick},label);
      const changed=(key,value)=>setEdit(old=>{
        const {version:_schema,revision:_revision,dailyNetReference:_income,fertilizerYield:_yield,crops,itemPrices,catalogEnabled,...writable}=view.configuration;
        const saved={...writable,crops:Object.fromEntries(Object.entries(crops).map(([id,crop])=>[id,{growMs:crop.growMs,seedCost:crop.seedCost}])),itemPrices,catalogEnabled};
        const next={...(old?.next||saved),[key]:value};
        const pickWritable=(entries,keys)=>Object.fromEntries(Object.entries(entries).filter(([id])=>keys.includes(id)));
        next.itemPrices=pickWritable(next.itemPrices,view.writableKeys.itemPrices);
        next.catalogEnabled=pickWritable(next.catalogEnabled,view.writableKeys.catalogEnabled);
        return {expectedVersion:old?.expectedVersion||String(view.configurationVersion),next};
      });
      const config=edit?.next||view?.configuration, catalog=view?.catalog||[], inventory=view?.inventory||[];
      const names=new Map(catalog.map(item=>[item.id,item.name]));
      const hasPending=Boolean(pending), available=inventory.filter(item=>item.available>0);
      const foods=available.filter(item=>catalog.find(entry=>entry.id===item.itemId)?.kind==='food');
      const itemChoice=(label,value,setValue,items)=>h('label',{className:'cp-field'},label,
        h('select',{value,disabled:busy||hasPending,onChange:event=>setValue(event.target.value)},
          h('option',{value:''},'请选择'),...items.map(item=>h('option',{key:item.id,value:item.id},item.name))));
      const integerValue=value=>/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value));
      const numeric=(label,value,onChange,min=0,noteText,max)=>field(label,{type:'number',min,max,step:'any',value,onChange:value=>onChange(value===''?null:Number(value)),disabled:busy||hasPending,note:noteText});
      const updateCrop=(crop,key,value)=>changed('crops',{...Object.fromEntries(Object.entries(config.crops).map(([id,row])=>[id,{growMs:row.growMs,seedCost:row.seedCost}])),[crop]:{growMs:config.crops[crop].growMs,seedCost:config.crops[crop].seedCost,[key]:value}});
      const updatePrice=(item,key,value)=>{const saved=catalog.find(entry=>entry.id===item);changed('itemPrices',{...config.itemPrices,[item]:{purchasePrice:saved.purchasePrice,sellPrice:saved.sellPrice,...config.itemPrices?.[item],[key]:value}});};
      const price=(item,key)=>config.itemPrices?.[item.id]&&Object.hasOwn(config.itemPrices[item.id],key)?config.itemPrices[item.id][key]:item[key];
      const forgetPending=()=>{
        try {localStorage.removeItem(storageKey);unresolved.current=null;setPending(null);setFault('');}
        catch(error){setFault(error.message);}
      };
      async function chooseFile(event) {
        const file=event.target.files?.[0];event.target.value='';if(!file)return;
        const signal=lifetime.current.signal;setFault('');
        try {
          if(!/\.(txt|md)$/i.test(file.name)||file.size>2*1024*1024)throw Error('请选择不超过 2 MB 的 .txt 或 .md 文件。');
          const content=await file.text();if(signal.aborted)return;
          if(!content.trim())throw Error('所选文件没有可导入的正文。');
          setImported({content,name:file.name});setTitle(file.name.replace(/\.(txt|md)$/i,''));
        }catch(error){if(!signal.aborted)setFault(error.message);}
      }
      return h(Card,{title:'钱包与物品',status:view?`${view.balance} 虚拟币`:'读取中',note:'钱包和物品由同一份账本管理。收入来自实际生产与自愿交易，没有每日自动发薪。'},
        fault&&h('p',{role:'alert'},fault),feedback&&h('p',{role:'status'},feedback),
        button('刷新钱包',refresh,busy),
        pending&&h('div',null,h('p',{role:'status'},'上次操作的结果尚未确认。重试会使用原请求编号，避免重复记账。'),
          !pending.invalid&&button('重试原操作',()=>send(pending)),
          h('p',{className:'cp-muted'},'请先刷新并核对流水；清除本机重试记录不会撤销已经提交的操作。'),
          button('已核对，清除重试记录',forgetPending)),
        view&&h(React.Fragment,null,
          facts([['余额',`${view.balance} 虚拟币`],['账本修订',view.revision],['当前经济配置',`${view.configuration.revision} · ${String(view.configurationVersion).slice(-12)}`]]),
          details('给零花钱',fields(field('金额',{type:'number',min:1,value:amount,onChange:setAmount,disabled:busy||hasPending}),
            field('备注',{value:note,onChange:setNote,maxLength:500,disabled:busy||hasPending,note:'金额默认留空，由你填写本次想给的数量。'})),
            button('给零花钱',()=>act({kind:'grant',amount:Number(amount),note}),hasPending||!integerValue(amount))),
          details('赠送物品',fields(itemChoice('物品',giftItem,setGiftItem,catalog),field('数量',{type:'number',min:1,value:giftQuantity,onChange:setGiftQuantity,disabled:busy||hasPending}),
            field('赠送备注',{value:giftNote,onChange:setGiftNote,maxLength:500,disabled:busy||hasPending})),
            button('赠送',()=>act({kind:'gift',itemId:giftItem,quantity:Number(giftQuantity),note:giftNote}),hasPending||!giftItem||!integerValue(giftQuantity))),
          details('立即投喂',h('p',{className:'cp-muted'},'从现有库存中扣除所选食物，并执行真实身体动作。'),
            itemChoice('库存食物',feedItem,setFeedItem,foods.map(item=>({id:item.itemId,name:`${names.get(item.itemId)||item.itemId}（可用 ${item.available}）` }))),
            button('立即投喂 1 份',()=>act({kind:'feed',itemId:feedItem,quantity:1}),hasPending||!feedItem)),
          details('商店',h('p',{className:'cp-muted'},'购买会扣除虚拟币，当前实际价格如下。'),
            ...catalog.map(item=>h('div',{key:item.id},h('h4',null,item.name),h('p',null,item.description),
              h('p',{className:'cp-muted'},`${item.enabled===false?'已下架 · ':''}购入 ${item.purchasePrice===null?'不可购买':item.purchasePrice+' 币'} · 售出 ${item.sellPrice===null?'不可售卖':item.sellPrice+' 币'}`),
              item.source&&h('p',{className:'cp-muted'},`来源：${item.source.kind==='owner-import'?'主人导入':'内置原创'} · ${item.source.name}`),
              button('购买 1 件',()=>act({kind:'buy',itemId:item.id,quantity:1}),hasPending||item.enabled===false||item.purchasePrice===null)))),
          details('库存',inventory.length?inventory.map(item=>h('div',{key:item.itemId},h('p',null,`${names.get(item.itemId)||item.itemId} · 共 ${item.quantity} · 可用 ${item.available} · 使用中 ${item.reserved}`),
            button('售出 1 件',()=>act({kind:'sell',itemId:item.itemId,quantity:1}),hasPending||item.available<1||catalog.find(entry=>entry.id===item.itemId)?.sellPrice==null))):h('p',null,'库存还是空的。')),
          details('导入阅读内容',h('p',{className:'cp-muted'},'选择本机 .txt 或 .md，导入后可在商店中按真实正文分段阅读。只导入你选择的文件。'),
            h('label',{className:'cp-field'},'选择阅读文件',h('input',{type:'file',accept:'.txt,.md,text/plain,text/markdown',disabled:busy||hasPending,onChange:chooseFile})),
            imported&&h(React.Fragment,null,field('标题',{value:title,onChange:setTitle,maxLength:200,disabled:busy||hasPending}),
              h('label',{className:'cp-field'},'读物类型',h('select',{value:readingFormat,disabled:busy||hasPending,onChange:event=>setReadingFormat(event.target.value)},
                h('option',{value:'article'},'文章'),h('option',{value:'book'},'书籍'))),
              h('p',null,`来源：主人导入 · ${imported.name} · ${imported.content.length} 字符`),preview('正文预览',imported.content.slice(0,1200)),
              button('导入阅读内容',()=>act({kind:'importReading',title:title.trim(),format:readingFormat,content:imported.content,source:{kind:'owner-import',name:imported.name}}),hasPending||!title.trim()))),
          details('经济配置',h('p',{className:'cp-muted'},'可调整商城卖给她的商品和生活节奏。日收益目标、作物产量与回收价不提供自定义。已种批次保留种下时的生长与产量参数。'),
            fields(...[['articlePrice','文章标准价格'],['bookPrice','书籍标准价格'],['improvedMealPrice','改善伙食价格'],
              ['compostCost','堆肥费用'],['waterDurationFactor','浇水时长比例'],['fertilizerGrowth','施肥生长调整']].map(([key,label])=>numeric(label,config[key],value=>changed(key,value)))),
            ...Object.entries(config.crops).map(([crop,value])=>h('div',{key:crop},h('h4',null,(names.get(`seed:${crop}`)||crop)+' · 新种批次'),fields(
              numeric('生长时间（毫秒）',value.growMs,next=>updateCrop(crop,'growMs',next),1),numeric('种子价格',value.seedCost,next=>updateCrop(crop,'seedCost',next))))),
            details('商品价格与上架',...catalog.filter(item=>item.kind!=='harvest').map(item=>h('div',{key:item.id},h('h4',null,item.name),fields(
              numeric('购入价格（留空不可购买）',price(item,'purchasePrice'),value=>updatePrice(item.id,'purchasePrice',value))),
              h('label',{className:'cp-switch'},h('input',{type:'checkbox',checked:config.catalogEnabled?.[item.id]!==false,disabled:busy||hasPending,
                onChange:event=>changed('catalogEnabled',{...config.catalogEnabled,[item.id]:event.target.checked})}),'上架')))),
            config.foodEffects&&details('食物身体效果',...Object.entries(config.foodEffects).map(([item,effects])=>h('div',{key:item},h('h4',null,names.get(item)||item),fields(
              ...[['hunger','饥饿变化'],['thirst','口渴变化'],['energy','体力变化'],['bladder','如厕需求变化'],['pain','疼痛变化']].map(([effect,label])=>numeric(label,effects[effect]??0,next=>changed('foodEffects',{...config.foodEffects,[item]:{...effects,[effect]:next}}),-1,'范围 -1 至 1；负数降低，正数提高对应状态值。',1)))))),
            button('保存经济配置',()=>mutate('economySettings',edit),hasPending||!edit||!view.configurationVersion),button('放弃配置修改',()=>setEdit(null),!edit)),
          details('最近流水',view.ledger?.length?view.ledger.slice().reverse().map(entry=>h('div',{key:entry.id},h('p',null,`${new Date(entry.at).toLocaleString()} · ${entry.note||entry.kind}`),
            h('p',{className:'cp-muted'},`${entry.moneyDelta>=0?'+':''}${entry.moneyDelta} 币 · 余额 ${entry.balance} · ${Object.entries(entry.itemDeltas).map(([item,quantity])=>`${names.get(item)||item} ${quantity>=0?'+':''}${quantity}`).join('，')||'物品无变化'}`))):h('p',null,'还没有经济流水。'))));
    }

    function LifePage({ workspaceId, request }) {
      const [view, setView] = useState(null), [busy, setBusy] = useState(false);
      const [error, setError] = useState(''), [feedback, setFeedback] = useState('');
      const [edit, setEdit] = useState(null);
      const lifetime = useRef(null), pending = useRef(false);
      React.useEffect(() => {
        const controller = new AbortController(); lifetime.current = controller;
        let reading = false;
        async function refresh() {
          if (!workspaceId || reading || pending.current) return;
          reading = true;
          try {
            const value = await request('lifeView', {workspaceId}, controller.signal);
            if (!controller.signal.aborted) { setView(value); setError(''); }
          } catch (e) { if (!controller.signal.aborted) setError(e.message); }
          finally { reading = false; }
        }
        void refresh(); const timer = setInterval(refresh, 3000);
        return () => { controller.abort(); clearInterval(timer); };
      }, [workspaceId, request]);
      async function change(endpoint, input) {
        pending.current = true; setBusy(true); setError(''); setFeedback('');
        const signal = lifetime.current.signal;
        try {
          const result = await request(endpoint, {workspaceId, ...input}, signal);
          if (signal.aborted) return;
          if (endpoint === 'lifePreferences') setEdit(null);
          setFeedback(result.event?.reaction || result.event?.text || (endpoint === 'lifePreferences' ? '已保存作息和预算。' :
            endpoint === 'lifeAction' ? '生活状态已更新。' : input.enabled === false ? '生活已暂停，计划和活动记录已保留。' : '生活已开启。'));
          const value = await request('lifeView', {workspaceId}, signal);
          if (!signal.aborted) setView(value);
        } catch (e) { if (!signal.aborted) setError(e.message); }
        finally { pending.current = false; if (!signal.aborted) setBusy(false); }
      }
      if (!workspaceId) return h('p', null, '请先绑定并初始化工作区。');
      const button = (label, click, disabled = false) => h('button', {type: 'button', className: 'cp-save', disabled: busy || disabled, onClick: click}, label);
      const home = view?.home, life = view?.life, plan = life?.currentPlan;
      const prefs = edit?.next || view?.preferences;
      const updatePref = (key, value) => setEdit(old => ({expected:old?.expected || view.preferences,
        next:{...(old?.next || view.preferences), [key]:value}}));
      return h(React.Fragment, null,
        h(Card, {title: '自主生活', status: view ? view.running ? '生活中' : '已暂停' : '读取中',
          note: '开启后，生活会话会使用当前模型安排活动和主动联络。'},
          error && h('p', {role: 'alert'}, error),
          feedback && h('p', {role: 'status'}, feedback),
          view && h('div', {className: 'cp-inline-actions'}, button(view.enabled ? '暂停生活' : '开启生活', () => change('lifeControl', {enabled: !view.enabled}))),
          home && facts([['现在', `${home.her.roomName} · ${home.her.spotLabel}，${home.her.activity}`],
            ['身体状态', Object.values(home.body.words).join('，')], ['生活时区', view.timeZone],
            ['下次考虑', life?.alarm ? `${new Date(life.alarm.at).toLocaleString()} · ${life.alarm.note || '生活唤醒'}` : '等待消息或计划条件'],
            ['生活会话', life?.homeSessionId ? '已保存，可在 DSH 会话列表打开' : '开启后创建'],
            ['生活会话用量估算', life?.spend ? life.spend.day + ' · ¥' + Number(life.spend.yuan).toFixed(4) : '暂无记录']]),
          view?.fault && h('p', {role: 'alert'}, view.fault),
          ...(life?.faults || []).map((fault, index) => h('p', {key: index, role: 'alert'}, fault)),
          h('p', {className: 'cp-muted'}, '安静模式暂停主动气泡，生活继续记录。生活运行时，自动碎碎念暂停；手动碎碎念仍可使用。')),
        h(Card, {title:'当前生活计划', note:'不同对话共用同一份计划。可以在对话中让它查看、调整、暂停或继续；没有下一项安排时也可以安心待着。',
          status:plan ? ({active:'进行中',paused:'已暂停',waiting:'等待中',completed:'已完成',cancelled:'已取消'}[plan.status] || plan.status) : '尚未安排'},
          plan ? facts([['想做什么',plan.goal],['原因',plan.reason],['当前活动',plan.steps?.[plan.cursor]?.activity || '本轮安排已结束'],
            ['实际进度',plan.execution ? ({pending:'已接受，等待执行',moving:'正在移动',working:'正在进行',waiting:'等待继续',completed:'已结束'}[plan.execution.phase] || plan.execution.phase) : '尚未开始'],
            ['未完成安排',(plan.steps || []).slice(plan.cursor+1).map(step=>step.activity).join(' → ') || '没有后续安排'],
            ['暂停或等待原因',plan.pauseReason || plan.replanReason || '无'],
            ['下次考虑',plan.nextConsiderAt ? new Date(plan.nextConsiderAt).toLocaleString() : '等待消息或计划条件']]) : h('p',null,'还没有生活计划。开启生活后可以由它决定，也可以先在对话里讨论。')),
        prefs && h(Card, {title:'可选作息与预算'}, h('div', {className:'cp-fields'},
          ...[['wake','起床时间'],['review','每日回顾']].map(([key,label]) => h('label', {className:'cp-field',key}, label,
            h('input', {type:'time', value:prefs[key], onChange:e => updatePref(key,e.target.value)}))),
          h('label', {className:'cp-field'}, '每日费用提醒（人民币，留空关闭）', h('input', {type:'number', min:'0.01', step:'any',
            value:prefs.dailyBudget ?? '', onChange:e => updatePref('dailyBudget',e.target.value === '' ? null : Number(e.target.value))})),
          h('label', {className:'cp-field'}, '未保存生活决定时自动补救次数（留空一次，0为关闭）', h('input', {type:'number', min:'0', step:'1',
            value:prefs.planningRepairAttempts ?? '', onChange:e => updatePref('planningRepairAttempts',e.target.value === '' ? null : Number(e.target.value))})),
          h('label', {className:'cp-field'}, '晚间回顾后整理生活会话', h('select', {value:prefs.compactAfterReview == null ? '' : String(prefs.compactAfterReview),
            onChange:e => updatePref('compactAfterReview',e.target.value === '' ? null : e.target.value === 'true')},
            h('option',{value:''},'未配置'),h('option',{value:'true'},'开启'),h('option',{value:'false'},'关闭')))),
          button('保存作息和预算', () => change('lifePreferences', edit), !edit)),
        h(EconomyPanel, {key:workspaceId, workspaceId, request}),
        view?.roomAvailable && h(RoomView, {workspaceId, request}),
        home && h(Card, {title: '陪它一会儿', note: '暂停自主生活时也能照顾它；这些操作不会调用模型。'},
          h('div', {className: 'cp-inline-actions'}, ...view.careActions.map(({action, label}) =>
            h(React.Fragment, {key: action}, button(label, () => change('lifeAction', {action})))))),
        home && h(Card, {title: '最近的生活', note: '原版保留最近 15 分钟的生活事件。会话工具活动另存于绑定 Repo。'},
          ...(home.events.length ? home.events.map((event, i) => h('p', {key: `${event.at}-${i}`}, `${new Date(event.at).toLocaleTimeString()} · ${event.text}`)) : [h('p', {key: 'empty', className: 'cp-muted'}, '这会儿还没有新活动。')]),
          ...(view.activity || []).slice(-8).map((event, i) => h('p', {key: `tool-${i}`, className: 'cp-muted'}, `${new Date(event.time).toLocaleTimeString()} · ${event.summary}`))));
    }

    function StandaloneAccess({workspaceId, request}) {
      const [result,setResult] = useState(''), lifetime = useRef(null);
      React.useEffect(() => { const c = new AbortController(); lifetime.current = c; return () => c.abort(); }, []);
      const create = async () => {
        const signal = lifetime.current.signal;
        try { const {file} = await request('petStandaloneAccess',{workspaceId},signal);
          if (!signal.aborted) setResult(file);
        } catch(error) { if (!signal.aborted) setResult(error.message); }
      };
      const copyControl = async () => {
        const signal = lifetime.current.signal;
        try { const {baseUrl,token} = await request('petControlAccess',{workspaceId},signal);
          if (signal.aborted) return;
          await navigator.clipboard.writeText(JSON.stringify({baseUrl,token}));
          if (!signal.aborted) setResult('已复制动作控制凭据，可交给你信任的控制程序。');
        } catch(error) { if (!signal.aborted) setResult(error.message); }
      };
      return details('独立桌宠', h('p',null,'独立窗口可离线陪伴。连接当前大肥鱼后，聊天继续使用同一个 DSH 会话。'),
        h('button',{type:'button',onClick:create},'生成本机连接文件'),
        h('button',{type:'button',onClick:copyControl},'复制第三方动作控制凭据'),result && h('p',{role:'status'},result));
    }
    // The platform is loaded after settings. Resolve its original editor lazily,
    // and keep it mounted between topic changes so its own drafts survive.
    function PlatformAppearance({getEditor}) {
      const [Editor,setEditor]=useState(()=>getEditor?.());
      React.useEffect(()=>{
        const sync=()=>setEditor(previous=>{const next=getEditor?.();return previous===next?previous:next;});
        sync();const timer=setInterval(sync,500);return()=>clearInterval(timer);
      },[getEditor]);
      return Editor?h(Editor):h(Card,{title:'外观与动作'},h('p',{className:'cp-muted'},'原版桌宠外观编辑器尚未加载。启用桌宠模块后会在这里显示。'));
    }
    function PresentationMigration({workspaceId,migration,request,onResolved}) {
      const [busy,setBusy]=useState(''),[error,setError]=useState('');
      const lifetime=useRef(null);
      React.useEffect(()=>{const c=new AbortController();lifetime.current=c;return()=>c.abort();},[workspaceId]);
      async function choose(field,choice) {
        const signal=lifetime.current.signal;setBusy(field);setError('');
        try {await request('presentationMigration',{workspaceId,field,choice,expectedConfigHash:migration.configHash},signal);if(!signal.aborted)await onResolved();}
        catch(e){if(!signal.aborted)setError(e.message);}
        finally{if(!signal.aborted)setBusy('');}
      }
      if(!migration?.conflicts?.length)return null;
      const show=value=>typeof value==='string'?value:JSON.stringify(value);
      return h(Card,{title:'外观设置需要选择',note:'两份已保存的设置存在差异。选择每项要保留的值，不会增加桌宠。'},
        ...migration.conflicts.map(row=>h('div',{key:row.field,className:'cp-migration'},h('h4',null,row.field),
          h('p',null,'原大肥鱼设置：'+show(row.legacy)),h('p',null,'原版桌宠设置：'+show(row.current)),
          h('div',{className:'cp-inline-actions'},...['legacy','current'].map(choice=>h('button',{key:choice,type:'button',className:'cp-save',disabled:Boolean(busy),onClick:()=>choose(row.field,choice)},choice==='legacy'?'使用原大肥鱼设置':'保留原版桌宠设置'))))),
        error&&h('p',{role:'alert'},error));
    }
    function PresentationTiming({workspaceId,initial,value,onChange,request}) {
      const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
      const lifetime=useRef(null);
      React.useEffect(()=>{const c=new AbortController();lifetime.current=c;return()=>c.abort();},[workspaceId]);
      const draft=value||initial&&{base:initial,next:initial};
      if(!draft)return null;
      async function save() {
        const signal=lifetime.current.signal;setBusy(true);setError('');setNotice('');
        try {const result=await request('presentationTiming',{workspaceId,expected:draft.base,eventsRefreshSec:draft.next},signal);
          const timing=result.timing||result;
          if(!signal.aborted){onChange({base:timing,next:timing});setNotice('定时互动间隔已保存。');}
        }catch(e){if(!signal.aborted)setError(e.message);}
        finally{if(!signal.aborted)setBusy(false);}
      }
      return h(Card,{title:'互动间隔',note:'碎碎念和余额查询的开关使用上方原版桌宠设置。自主生活运行时，自动碎碎念暂停。'},
        fields(...[['whisper','碎碎念间隔（秒）'],['sleepTalk','梦话间隔（秒）'],['balance','余额查询间隔（秒）']].map(([key,label])=>field(label,{type:'number',min:1,max:86400,value:draft.next[key],disabled:busy,onChange:text=>onChange({...draft,next:{...draft.next,[key]:text===''?'':Number(text)}})}))),
        h('div',{className:'cp-inline-actions'},h('button',{type:'button',className:'cp-save',disabled:busy||equal(draft.base,draft.next),onClick:save},busy?'正在保存…':'保存互动间隔')),
        error&&h('p',{role:'alert'},error),notice&&h('p',{role:'status'},notice));
    }
    // Drafts live in SettingsPage so changing tabs never discards new file edits.
    function FoundationEditor({workspaceId, request, value, onChange, endpoint = 'foundation'}) {
      const self = endpoint === 'self', title = self ? '我是谁' : '基础说明';
      const [error,setError]=useState(''),[busy,setBusy]=useState(false),[attempt,retry]=useState(0),[notice,setNotice]=useState('');
      const lifetime=useRef(null);
      React.useEffect(()=>{
        const controller=new AbortController();lifetime.current=controller;
        if(workspaceId&&!value) request(endpoint,{workspaceId},controller.signal).then(base=>{
          if(!controller.signal.aborted)onChange({base,text:base.text});
        },e=>{if(!controller.signal.aborted)setError(e.message);});
        return()=>controller.abort();
      },[workspaceId,request,attempt,endpoint]);
      async function save() {
        const signal=lifetime.current.signal;setBusy(true);setError('');setNotice('');
        try {const base=await request(endpoint,{workspaceId,expectedRevision:value.base.revision,text:value.text},signal);
          if(!signal.aborted){onChange({base,text:base.text});setNotice(title+'已保存，下一次对话使用新内容。');}
        } catch(e){if(!signal.aborted)setError(e.message);}
        finally {if(!signal.aborted)setBusy(false);}
      }
      return h(Card,{title,note:self ? '伙伴逐渐形成的自我认识。与主人填写的人设分别保存，关闭自主生活或记忆后仍可使用。' : '对话规则、关系和能力说明。关闭自主生活后仍会使用。',status:value?.base.text?.trim()?'已填写':'未填写'},
        !workspaceId?h('p',null,'请先绑定并初始化工作区。'):value?h(React.Fragment,null,
          h('label',{className:'cp-field'},title+'内容',h('textarea',{className:'cp-foundation',value:value.text,maxLength:64000,
            disabled:busy,onChange:e=>onChange({...value,text:e.target.value})})),
          h('div',{className:'cp-inline-actions'},h('button',{type:'button',className:'cp-save cp-primary',disabled:busy||value.text===value.base.text,onClick:save},busy?'正在保存…':'保存'+title)),
          h('p',{className:'cp-muted'},self ? '可以留空，也可以在普通聊天中逐渐更新。' : '保存在 .chatpet/COMPANION.md。可以留空，空白时不会加载另一套预设说明。')):
          h('p',{role:'status'},error?'未能读取'+title+'。':'正在读取'+title+'…'),
        notice&&h('p',{role:'status'},notice),error&&h('p',{role:'alert'},error),error&&!value&&h('button',{type:'button',className:'cp-save',onClick:()=>{setError('');retry(n=>n+1);}},'重试读取'));
    }
    function EmotionEditor({workspaceId,request,value,onChange}) {
      const [error,setError]=useState(''),[busy,setBusy]=useState(false),[attempt,retry]=useState(0),[notice,setNotice]=useState('');
      const lifetime=useRef(null);
      React.useEffect(()=>{
        const controller=new AbortController();lifetime.current=controller;
        if(workspaceId&&!value) request('emotionState',{workspaceId},controller.signal).then(base=>{
          if(!controller.signal.aborted)onChange({base,mood:base.state?.mood||'',reason:base.state?.reason||'',feelings:(base.state?.feelings||[]).join('、')});
        },e=>{if(!controller.signal.aborted)setError(e.message);});
        return()=>controller.abort();
      },[workspaceId,request,attempt]);
      async function save() {
        const signal=lifetime.current.signal;setBusy(true);setError('');setNotice('');
        try {const base=await request('emotionUpdate',{workspaceId,expectedRevision:value.base.revision,expectedHash:value.base.contentHash,
          mood:value.mood,reason:value.reason,feelings:value.feelings.split(/[、,，]/).map(s=>s.trim()).filter(Boolean)},signal);
          if(!signal.aborted){onChange({base,mood:base.state?.mood||'',reason:base.state?.reason||'',feelings:(base.state?.feelings||[]).join('、')});setNotice('当前心情已保存。');}
        }catch(e){if(!signal.aborted)setError(e.message);}
        finally{if(!signal.aborted)setBusy(false);}
      }
      const dirty=value&&(value.mood!==(value.base.state?.mood||'')||value.reason!==(value.base.state?.reason||'')||value.feelings!==(value.base.state?.feelings||[]).join('、'));
      const edit=key=>text=>onChange({...value,[key]:text});
      return h(Card,{title:'此刻的心情',note:'心情表达它的感受和倾向；房间与桌宠共同呈现实际行为。',status:value?({ready:'已保存',empty:'尚未记录',unavailable:'暂不可用'}[value.base.status]):'读取中'},
        !workspaceId?h('p',null,'请先绑定并初始化工作区。'):value?h(React.Fragment,null,
          value.base.state&&h('div',{className:'cp-emotion'},h('div',{className:'cp-big'},value.base.state.mood),h('p',{className:'cp-muted'},new Date(value.base.state.at).toLocaleString('zh-CN'))),
          value.base.status==='unavailable'&&h('p',{role:'status'},'旧心情的依据暂时无法确认，请重新写下当前的感受。'),
          fields(field('心情',{value:value.mood,onChange:edit('mood'),maxLength:160}),field('感受标签',{value:value.feelings,onChange:edit('feelings'),note:'用顿号分隔，例如开心、想聊天。',maxLength:500}),
            field('原因与想法',{value:value.reason,onChange:edit('reason'),multiline:true,wide:true,maxLength:4000})),
          h('div',{className:'cp-inline-actions'},h('button',{type:'button',className:'cp-save cp-primary',disabled:busy||!dirty||!value.mood.trim(),onClick:save},busy?'正在保存…':'保存当前心情')),
          value.base.reason&&h('p',{className:'cp-muted'},value.base.reason)):
          h('p',{role:'status'},error?'未能读取当前心情。':'正在读取当前心情…'),
        notice&&h('p',{role:'status'},notice),error&&h('p',{role:'alert'},error),error&&!value&&h('button',{type:'button',className:'cp-save',onClick:()=>{setError('');retry(n=>n+1);}},'重试读取'));
    }
    function SettingsPage({ request, getAppearanceEditor }) {
      const [active, setActive] = useState('overview');
      const [documents,setDocuments]=useState({});
      const [appearanceVisited,setAppearanceVisited]=useState(false);
      const documentDirty=Object.values(documents).some(row=>row.foundation&&row.foundation.text!==row.foundation.base.text||row.self&&row.self.text!==row.self.base.text||row.emotion&&(row.emotion.mood!==(row.emotion.base.state?.mood||'')||row.emotion.reason!==(row.emotion.base.state?.reason||'')||row.emotion.feelings!==(row.emotion.base.state?.feelings||[]).join('、'))||row.timing&&!equal(row.timing.base,row.timing.next));
      const [snapshot, setSnapshot] = useState(null);
      const [draft, setDraft] = useState(null);
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState(null);
      const [notice, setNotice] = useState('');
      const [error, setError] = useState('');
      const [desktopFailure,setDesktopFailure]=useState(null);
      const lifetime = useRef(null), sequence = useRef(0);
      const desktopFlight=useRef(null);
      const tabs = useRef([]), prefix = useId();
      const focusAfterNavigation = useRef(null);
      React.useEffect(() => {
        if (!focusAfterNavigation.current) return;
        const target = document.getElementById(focusAfterNavigation.current);
        focusAfterNavigation.current = null;
        target?.focus();
      }, [active]);
      function selectTab(tab) {
        if(tab==='desktop')setAppearanceVisited(true);
        setActive(tab);
        setNotice('');
      }
      function navigateTo(tab, target) {
        focusAfterNavigation.current = target ? `${prefix}-${target}` : `${prefix}-${tab}-panel`;
        selectTab(tab);
      }
      const dirty = documentDirty || Boolean(snapshot && draft && (!equal(snapshot.identity, draft.identity)
        || !equal(snapshot.companion, draft.companion) || snapshot.policy.quiet !== draft.quiet || !equal(snapshot.preferences.conversation, draft.conversation)
        || (snapshot.preferences.workspace?.id ?? null) !== draft.workspaceId || snapshot.profile.text !== draft.profile));
      function accept(value) {
        setSnapshot(value); setDraft({ companion: value.companion, identity: { ...value.identity }, quiet: value.policy.quiet,
          workspaceId: value.preferences.workspace?.id ?? null, conversation: { ...value.preferences.conversation }, profile: value.profile.text });
        setDesktopFailure(null);
        if(value.desktop&&!value.desktop.running&&(value.desktop.starting||value.desktop.requested))waitForDesktop(value.workspace.target?.id);
      }
      function stopDesktopWait() {
        desktopFlight.current?.abort();desktopFlight.current=null;
      }
      function waitForDesktop(workspaceId) {
        stopDesktopWait();
        if(!workspaceId)return;
        const controller=new AbortController();desktopFlight.current=controller;
        let timedOut=false;
        const timeout=setTimeout(()=>{timedOut=true;controller.abort();},20000);
        const abort=()=>controller.abort();lifetime.current.signal.addEventListener('abort',abort,{once:true});
        const pause=()=>new Promise((resolve,reject)=>{
          const cleanup=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',cancel);};
          const cancel=()=>{cleanup();reject(Error('Desktop wait cancelled'));};
          const timer=setTimeout(()=>{cleanup();resolve();},700);
          controller.signal.addEventListener('abort',cancel,{once:true});
          if(controller.signal.aborted)cancel();
        });
        void(async()=>{
          try {
            while(true) {
              await pause();
              const value=await request('snapshot',{},controller.signal);
              if(controller.signal.aborted||desktopFlight.current!==controller)return;
              if(value.workspace.target?.id!==workspaceId)throw Error('工作区已切换，请刷新设置。');
              // Status observation must not acknowledge or replace another form's draft.
              setSnapshot(old=>old?.workspace.target?.id===workspaceId?{...old,desktop:value.desktop}:old);
              if(value.desktop?.running){setDesktopFailure(null);setNotice('桌宠已打开。');return;}
              if(!value.desktop?.requested&&!value.desktop?.starting)throw Error('桌宠未能启动，可以重试。');
            }
          }catch(failure){
            if(desktopFlight.current===controller&&!lifetime.current.signal.aborted&&(!controller.signal.aborted||timedOut)) {
              setDesktopFailure(workspaceId);setNotice('');
              setError(timedOut?'桌宠启动等待超时，可以取消或重试。':failure.message);
            }
          }finally{
            clearTimeout(timeout);lifetime.current.signal.removeEventListener('abort',abort);
            if(desktopFlight.current===controller)desktopFlight.current=null;
          }
        })();
      }
      async function load() {
        stopDesktopWait();
        const version = ++sequence.current;
        setLoading(true); setError('');
        try { const value = await request('snapshot', {}, lifetime.current.signal); if (version === sequence.current) accept(value); }
        catch (failure) { if (version === sequence.current && !lifetime.current.signal.aborted) setError(failure.message); }
        finally { if (version === sequence.current) setLoading(false); }
      }
      React.useEffect(() => {
        const controller = new AbortController(); lifetime.current = controller;
        void load();
        return () => { sequence.current++; stopDesktopWait(); controller.abort(); };
      }, []);
      async function saveWorkspace(kind, input, signal) {
        // Binding and initialization can each change the authoritative workspace.
        stopDesktopWait();
        setSnapshot(null);
        setDraft(null);
        let failure;
        try {
          const value = await request(kind, input, signal);
          if (kind === 'preferences' && value.workspace) {
            await request('initialize', { expectedPreferencesRevision: value.revision }, signal);
          }
        } catch (error) {
          failure = error;
        }
        if (signal.aborted) return;
        let latest;
        try {
          latest = await request('snapshot', {}, signal);
        } catch (readError) {
          throw new Error([failure?.message, readError.message].filter(Boolean).join(' '));
        }
        if (signal.aborted) return;
        accept(latest);
        if (failure) {
          if (kind === 'preferences' && (latest.preferences.workspace?.id ?? null) !== input.workspaceId) {
            setDraft(old => ({ ...old, workspaceId: input.workspaceId }));
          }
          throw failure;
        }
        setNotice(kind === 'initialize' ? '工作区资料已检查并加载。'
          : latest.preferences.workspace ? '工作区已绑定，资料目录已初始化。' : '工作区已解绑，原目录和记录已保留。');
      }
      async function save(kind, input, scope) {
        if (busy) return;
        setBusy(kind); setError(''); setNotice('');
        const endpoint=kind==='desktopRetry'?'desktopOpen':kind;
        if(endpoint==='desktopOpen'||endpoint==='desktopClose'){stopDesktopWait();setDesktopFailure(null);}
        try {
          if (kind === 'initialize' || scope === 'workspace') {
            await saveWorkspace(kind, input, lifetime.current.signal);
            return;
          }
          if(kind==='desktopRetry')await request('desktopClose',input,lifetime.current.signal);
          const value = await request(endpoint, input, lifetime.current.signal);
          if (lifetime.current.signal.aborted) return;
          // Acknowledge exactly the saved section; do not discard edits on other tabs.
          if (kind === 'identity') {
            const identity = { revision: value.revision, displayName: value.displayName, character: value.character };
            setSnapshot(old => ({ ...old, identity })); setDraft(old => ({ ...old, identity }));
          } else if (endpoint === 'desktopOpen' || endpoint === 'desktopClose') {
            setSnapshot(old => ({ ...old, desktop: value }));
            if(endpoint==='desktopClose'){setNotice('桌宠已关闭。');return;}
            if(value.running){setNotice('桌宠已打开。');return;}
            if(value.starting||value.requested){setNotice('桌宠正在启动…');waitForDesktop(input.workspaceId);return;}
            setDesktopFailure(input.workspaceId);throw Error('桌宠未能启动，可以重试。');
          } else if (kind === 'companion') {
            setSnapshot(old => ({ ...old, companion: value }));
            setDraft(old => ({ ...old, companion: { ...old.companion, ...Object.fromEntries(scope.map(key => [key, value[key]])) } }));
          } else if (kind === 'quiet') {
            setSnapshot(old => ({ ...old, policy: value })); setDraft(old => ({ ...old, quiet: value.quiet }));
          } else if (kind === 'profile') {
            setSnapshot(old => ({ ...old, profile: value })); setDraft(old => ({ ...old, profile: value.text }));
          } else {
            setSnapshot(old => {
              if(old?.preferences.revision!==input.expectedRevision
                || old.preferences.workspace?.id!==value.workspace?.id
                || old.preferences.workspace?.path!==value.workspace?.path)return old;
              return {...old,preferences:value,editorScope:old.editorScope
                ? {...old.editorScope,preferencesRevision:value.revision}:old.editorScope};
            });
          }
          setNotice('设置已保存并生效。');
        } catch (failure) {
          if(endpoint==='desktopOpen')setDesktopFailure(input.workspaceId);
          if (!lifetime.current.signal.aborted) setError(failure.message);
        } finally { if (!lifetime.current.signal.aborted) setBusy(null); }
      }
      function refresh() {
        if (dirty && !window.confirm('刷新会放弃尚未保存的修改，继续吗？')) return;
        setDraft(null); setSnapshot(null); setDocuments({});
        setNotice(''); void load();
      }
      const editIdentity = key => value => setDraft(old => ({ ...old, identity: { ...old.identity, [key]: value } }));
      const identityDirty = snapshot && draft && !equal(snapshot.identity, draft.identity);
      const quietDirty = snapshot && draft && snapshot.policy.quiet !== draft.quiet;
      const workspaceDirty = snapshot && draft && (snapshot.preferences.workspace?.id ?? null) !== draft.workspaceId;
      const conversationDirty = snapshot && draft && !equal(snapshot.preferences.conversation, draft.conversation);
      const profileDirty = snapshot && draft && snapshot.profile.text !== draft.profile;
      const companionDirty = snapshot && draft && !equal(snapshot.companion, draft.companion);
      const otherWorkspaceDrafts = companionDirty || identityDirty || quietDirty || conversationDirty || profileDirty || documentDirty;
      const saveButton = (kind, dirtySection, onClick, label) => h('div', { style: { marginTop: 16 } },
        h('button', { type: 'button', className: 'cp-save', disabled: Boolean(busy) || !dirtySection, onClick }, busy === kind ? '正在保存…' : label));
      const savePreferences = (part) => {
        const conversation = part === 'conversation' ? draft.conversation : snapshot.preferences.conversation;
        const workspaceId = part === 'workspace' ? draft.workspaceId : snapshot.preferences.workspace?.id ?? null;
        return save('preferences', { expectedRevision: snapshot.preferences.revision, workspaceId, conversation }, part);
      };
      function content() {
        if (loading) return h('p', { role: 'status' }, '正在读取设置…');
        if (!snapshot || !draft) return busy ? h('p', { role: 'status' }, '正在核对工作区资料…') : null;
        const repo = snapshot.preferences.workspace;
        const ready = snapshot.workspace.state === 'ready';
        const boundId = snapshot.workspace.target?.id;
        const world = new Set(snapshot.worldModules);
        const document=documents[boundId]||{};
        const editDocument=key=>value=>setDocuments(old=>({...old,[boundId]:{...old[boundId],[key]:value}}));
        const workspaceId = ready ? boundId : null;
        const worldView = (section, revision, render) => h(WorkspaceView, { key: workspaceId ?? 'unbound',
          workspaceId, section, request, revision }, render);
        const sourceAbsent = () => h('p', { className: 'cp-muted' }, '对应的 World 组件尚未加载。');
        const desktopPending=Boolean(snapshot.desktop&&!snapshot.desktop.running&&(snapshot.desktop.requested||snapshot.desktop.starting));
        const desktopState = !snapshot.desktop ? '未加载' : snapshot.desktop.running ? '已打开' : desktopFailure===boundId ? '启动未完成' : desktopPending ? '启动中' : '已关闭';
        const button = (label, onClick, disabled = false, primary = false) => h('button',
          { type: 'button', className: primary ? 'cp-save cp-primary' : 'cp-save', onClick, disabled: Boolean(busy) || disabled }, label);
        const jump = (label, tab, target, primary = false) => button(label, () => navigateTo(tab, target), false, primary);
        const bindLink = () => jump('绑定工作区', 'workspace', 'binding');
        const needsWorkspace = (title) => h(Card, { title, note: '绑定并初始化工作区后，就可以在这里调整设置。' }, bindLink());
        const desktopAvailable = Boolean(snapshot.desktop && boundId && (snapshot.desktop.running || desktopPending || ready));
        const desktopButton = (primary = false) => h(React.Fragment,null,
          button(snapshot.desktop?.running?'关闭桌宠':desktopPending?'取消启动':desktopFailure===boundId?'重试打开桌宠':'打开桌宠',
            ()=>save(snapshot.desktop.running||desktopPending?'desktopClose':desktopFailure===boundId?'desktopRetry':'desktopOpen',{workspaceId:boundId}),!desktopAvailable,primary),
          desktopPending&&desktopFailure===boundId&&button('重试打开桌宠',()=>save('desktopRetry',{workspaceId:boundId}),!desktopAvailable));
        const walletCapability = snapshot.capabilities.find(item => item.id === 'life.economy');
        const capabilityState = (owner) => {
          if (owner === 'memory') return memoryProviderLabels[snapshot.memory?.provider] ?? '未配置';
          const labels = snapshot.capabilities.filter(item => item.owner === owner && item !== walletCapability).map(item => capabilityLabels[item.state] ?? '未知');
          return [...new Set(labels)].join(' / ') || (owner === 'bilibili' ? '未报告' : capabilityLabels.unavailable);
        };
        const numberField = (key, label, max, min = 0) => field(label, { type: 'number', min, max,
          value: draft.companion[key] ?? '', placeholder:'未配置', onChange: value => setDraft(old => ({ ...old, companion: {
            ...old.companion, [key]: value === '' ? null : Number(value),
          } })) });
        const switchField = (key, label) => h('label', { key, className: 'cp-field' }, label,
          h('select', { value: draft.companion[key] == null ? '' : String(draft.companion[key]),
            onChange: event => setDraft(old => ({ ...old, companion: { ...old.companion,
              [key]: event.target.value === '' ? null : event.target.value === 'true' } })) },
            h('option',{value:''},'未配置'),h('option',{value:'true'},'开启'),h('option',{value:'false'},'关闭')));
        const saveCompanion = (keys, label) => {
          const edited = keys.some(key => draft.companion[key] !== snapshot.companion[key]);
          const settings = { ...snapshot.companion, ...Object.fromEntries(keys.map(key => [key, draft.companion[key]])) };
          return saveButton('companion', edited && ready, () => save('companion', {
            workspaceId: boundId, expectedSettings: snapshot.companion, settings,
          }, keys), label);
        };
        if (active === 'overview') {
          return h(React.Fragment,null,
            h('div',{className:'cp-grid'},
              h(Card,{title:'陪伴',status:desktopState},h('div',{className:'cp-big'},snapshot.identity.displayName||'未命名伙伴'),
                h('p',{className:'cp-muted'},repo?.title||'先为大肥鱼选一个工作区。'),
                h('div',{className:'cp-inline-actions'},desktopButton(true),jump('编辑角色','role','identity'))),
              h(Card,{title:'对话与记忆',status:snapshot.nativeConversationReady?'已就绪':'待就绪'},
                facts([['工作区',repo?.title||'尚未选择'],['长期记忆',snapshot.memory?.provider?snapshot.memory.error?'暂时不可用，聊天照常':snapshot.memory.enabled?'已启用':'已关闭':'未连接']]),
                h('div',{className:'cp-inline-actions'},jump('查找档案','archive','archive'),repo?jump('管理工作区','workspace','binding'):bindLink()))),
            h('div',{style:{height:14}}),
            h(RoomView,{key:workspaceId||'unbound',workspaceId,request}),
            h(Card,{title:'日常',note:'角色、记忆和心情持续保留。自主生活决定是否安排活动和主动联络。'},
              h('div',{className:'cp-inline-actions'},jump('看看心情','emotion'),jump('管理生活','life'),jump('连接聊天渠道','connections'))));
        }
        if (active === 'life') return h(React.Fragment,null,
          snapshot.companion&&h(Card,{title:'离线身体变化',note:'初始最多计入4小时新增消耗；关闭或隐藏房间不会暂停后台生活。上限不治疗离线前已有的不适，作物另按真实时间生长。'},
            fields(numberField('offlineBodyHours','离线新增消耗上限（小时，0为不增加）',168),
              numberField('offlineNeedCeilingPercent','离线需求温和上限（%）',100),numberField('offlineEnergyFloorPercent','离线精力温和下限（%）',100)),
            saveCompanion(['offlineBodyHours','offlineNeedCeilingPercent','offlineEnergyFloorPercent'],'保存离线身体设置')),
          h(LifePage, {key: workspaceId || 'unbound', workspaceId, request}));
        if (active === 'connections') return workspaceId?h(ChannelsPage,{key:workspaceId,workspaceId,request}):needsWorkspace('连接聊天渠道');
        if (active === 'emotion') return h(React.Fragment,null,
          h(EmotionEditor,{key:'emotion-'+(workspaceId||'unbound'),workspaceId,request,value:document.emotion,onChange:editDocument('emotion')}),
          snapshot.companion&&h(Card,{title:'心情记录',note:'数量与时长共同决定近期心情的保留范围。'},fields(numberField('recentMoodCount','最近心情变化（次）',100),numberField('recentMoodHours','心情保留时长（小时）',720)),saveCompanion(['recentMoodCount','recentMoodHours'],'保存心情记录设置')),
          world.has('mood')&&worldView('emotion',null,view=>view.emotion&&h(Card,{title:'表达方式'},facts([['可用动作',view.emotion.actions.join('、')||'暂无'],['可用贴图',view.emotion.stickers.join('、')||'暂无']])))
        );
        if (active === 'archive') {
          return h(React.Fragment, null,
            h(Card, { id: `${prefix}-archive`, title: '对话归档', note: '完整的 DSH 会话随绑定工作区保存。下方检索读取已收录且仍可查看的内容。' },
              world.has('archive') ? worldView('sessions', null, view => facts([
                ['绑定工作区', repo?.title], ['DSH 已关联会话', view.sessions === null ? '未能读取数量' : view.sessions + ' 个会话'],
              ])) : sourceAbsent(),
              !ready && bindLink()),
            world.has('memory') && workspaceId && snapshot.memory?.provider
              ? h(ArchiveSearch, { key: workspaceId, workspaceId, request })
              : h(Card, { title: '档案检索' }, h('p', null, !world.has('memory') ? 'World 记忆查询组件尚未加载。'
                : !workspaceId ? '绑定并初始化工作区后可以检索。' : '此工作区尚未配置长期记忆服务。')),
            h(Card, { title: '近期历史与长期记忆' },
              world.has('history') && h('p', null, '近期历史选择和去重组件已加载。当前续聊沿用 DSH 原生历史，跨会话召回由 Mnemosyne 提供。'),
              world.has('compaction') && snapshot.companion?.memorySummaryTurns != null && snapshot.companion?.memorySummaryIdleMinutes != null && h('p', null, '积累 ' + snapshot.companion.memorySummaryTurns + ' 轮或空闲 ' +
                snapshot.companion.memorySummaryIdleMinutes + ' 分钟后整理，最短间隔 ' + (snapshot.companion.memorySummaryMinimumMinutes ?? 0) + ' 分钟。'),
              world.has('memory') && snapshot.companion?.memoryRecallCount != null && snapshot.companion?.memoryRecallBlockChars != null && h('p', null, '每次最多召回 ' + snapshot.companion.memoryRecallCount +
                ' 块，每块最多 ' + snapshot.companion.memoryRecallBlockChars + ' 字符。'),
              !world.has('history') && !world.has('memory') && !world.has('compaction') && sourceAbsent(),
              snapshot.companion && h('p',{className:'cp-muted'},'记忆召回与整理参数见下方。')),
            snapshot.companion?h(Card,{id:`${prefix}-recall`,title:'召回与整理',note:'每轮按当前话题刷新记忆，完整聊天记录继续保留。登记的外部聊天共用同一记忆库，内容区分说话人和群。'},fields(
              numberField('memorySummaryTurns','积累对话轮数',200,1),numberField('memorySummaryIdleMinutes','空闲多久整理（分钟）',1440,1),numberField('memorySummaryMinimumMinutes','最短整理间隔（分钟）',1440),numberField('memoryRecallCount','每次召回块数',50,1),numberField('memoryRecallBlockChars','每块最多字符',4000,128)),saveCompanion(memoryKeys,'保存记忆设置')):needsWorkspace('记忆设置'));
        }
        if (active === 'role') {
          return h(React.Fragment, null,
            h(Card, { id: `${prefix}-identity`, title: '身份与角色', note: ready
              ? '角色设定保存在工作区的 .chatpet/SOUL.md，下一轮对话使用新内容。'
              : '角色先保存在本机，初始化工作区时会写入角色文件。' }, fields(
              field('角色名称', { value: draft.identity.displayName, onChange: editIdentity('displayName'), wide: true }),
              field('角色设定', { value: draft.identity.character, onChange: editIdentity('character'), multiline: true, wide: true })),
              saveButton('identity', identityDirty, () => save('identity', { expectedScope:snapshot.editorScope,expectedRevision: snapshot.identity.revision,
                displayName: draft.identity.displayName, character: draft.identity.character }), '保存角色')),
            h(Card, { title: '用户资料', note: ready ? '填写希望大肥鱼了解的称呼、习惯或偏好。内容保存在 .chatpet/USER.md。' : '绑定工作区后可以填写希望大肥鱼了解的资料。' },
              field('用户资料内容', { value: draft.profile, multiline: true, wide: true, disabled: !ready,
                onChange: value => setDraft(old => ({ ...old, profile: value })) }),
              saveButton('profile', profileDirty && ready, () => save('profile', {
                expectedScope:snapshot.editorScope,expectedRevision: snapshot.profile.revision, text: draft.profile }), '保存用户资料')),
            h(Card, { id: `${prefix}-prompt`, title: '角色提示预览', note: 'World 的人设提示机制把已保存的角色与用户资料放入当前工作区的对话。' },
              world.has('persona') ? worldView('profile', snapshot.identity.revision + '/' + snapshot.profile.revision, view =>
                h(React.Fragment, null, preview('角色设定 · SOUL.md', view.profile.identity), preview('用户资料 · USER.md', view.profile.user),
                  h('p', { className: 'cp-muted' }, '人设与用户资料约 ' + view.profile.estimatedTokens + ' tokens。单轮总用量见 DSH 会话。'))) : sourceAbsent()),
            h(FoundationEditor,{key:'foundation-'+(workspaceId||'unbound'),workspaceId,request,value:document.foundation,onChange:editDocument('foundation')}),
            h(FoundationEditor,{key:'self-'+(workspaceId||'unbound'),workspaceId,request,endpoint:'self',value:document.self,onChange:editDocument('self')}),
            workspaceId && h(CompanionArchive,{key:'records-'+workspaceId,workspaceId,request,companionName:snapshot.identity.displayName}));
        }
        if (active === 'desktop') {
          return h(React.Fragment, null,
            h(Card, { title: '桌面陪伴', status: desktopState, note: '点击角色会收到回应。右键打开菜单，Cmd 或 Ctrl 加点击打开聊天。' }, desktopButton()),
            h('div',{className:'cp-migration-panel'},h(PresentationMigration,{key:'migration-'+boundId,workspaceId:boundId,migration:snapshot.presentation?.migration,request,onResolved:async()=>{const value=await request('snapshot',{},lifetime.current.signal);if(!lifetime.current.signal.aborted)setSnapshot(value);}})),
            snapshot.companion ? h(React.Fragment, null,
              h(Card,{title:'对话表现'},fields(switchField('desktopReplyBubble','回复显示在桌宠气泡'),numberField('desktopBubbleSeconds','文字气泡显示时长（秒）',300,1),numberField('stickerProbabilityPercent','想发贴图时的出现概率（%）',100))),
              h(PresentationTiming,{key:'timing-'+boundId,workspaceId:boundId,initial:snapshot.presentation?.timing,value:document.timing,onChange:editDocument('timing'),request}),
              h(Card,{title:'动作记录'},fields(numberField('recentActionCount','最近动作数量（次）',500),numberField('recentActionMinutes','动作保留时长（分钟）',10080))),
              saveCompanion(['desktopReplyBubble','desktopBubbleSeconds','stickerProbabilityPercent','recentActionCount','recentActionMinutes'],'保存桌宠互动设置'))
              : needsWorkspace('桌宠偏好'),
            h(Card, { title: '主动联系', note: '安静模式会暂停自动碎碎念、待办提醒和定时余额查询。你仍然可以主动找伙伴聊天。' },
              h('label', { className: 'cp-switch' },
                h('input', { type: 'checkbox', checked: draft.quiet,
                  onChange: event => setDraft(old => ({ ...old, quiet: event.target.checked })) }), '安静模式'),
              saveButton('quiet', quietDirty, () => save('quiet', { expectedRevision: snapshot.policy.revision, quiet: draft.quiet }), '保存安静模式')),
            boundId && snapshot.platformAvailable && h(StandaloneAccess,{key:boundId,workspaceId:boundId,request}),
            details('桌宠快捷键', h('p', null, '鼠标悬停在桌宠上时，按 L 打开对话、S 截图、D 查看待办、Z 睡觉。')));
        }
        const missing = draft.workspaceId && !snapshot.workspaces.some(row => row.id === draft.workspaceId);
        return h(React.Fragment, null,
          h(Card, { id: `${prefix}-binding`, title: '绑定工作区', note: '选择大肥鱼存放角色、记忆和聊天记录的位置。' },
            h('label', { className: 'cp-field' }, 'DSH 工作区',
              h('select', { value: draft.workspaceId ?? '', disabled: !snapshot.workspaceAvailable,
                onChange: event => setDraft(old => ({ ...old, workspaceId: event.target.value || null })) },
                h('option', { value: '' }, '不绑定工作区'),
                missing && h('option', { value: draft.workspaceId, disabled: true }, '已保存的工作区不存在，请重新选择'),
                ...snapshot.workspaces.map(row => h('option', { key: row.id, value: row.id, disabled: row.state !== 'ok' },
                  `${row.title} · ${row.path}${row.state === 'ok' ? '' : '（目录不可用）'}`)))),
            !snapshot.workspaceAvailable && h('p', { role: 'status' }, 'DSH 工作区服务尚未就绪，请稍后刷新。'),
            repo && h('p', { className: 'cp-muted' }, `当前绑定 · ${repo.title} · ${repo.path}`),
            otherWorkspaceDrafts && h('p', { className: 'cp-muted' }, '请先保存其他设置草稿，或刷新以放弃修改，再切换工作区。'),
            saveButton('preferences', workspaceDirty && snapshot.workspaceAvailable && !otherWorkspaceDrafts,
              () => savePreferences('workspace'), draft.workspaceId ? '绑定并初始化' : '解除绑定')),
          h(Card, { title: '资料与会话', status: ready && snapshot.storage && !snapshot.storage.complete ? '存储待迁入工作区' : workspaceLabels[snapshot.workspace.state] },
            h('p', null, snapshot.workspace.state === 'pending' ? '工作区资料待初始化。点击下方按钮建立缺失文件，不会覆盖已有内容。' : snapshot.workspace.error || (ready
              ? '角色、用户资料和设置已从 .chatpet/ 加载。完整会话随工作区保存，换设备绑定同一个工作区后可以恢复。'
              : '初始化会建立 .chatpet/ 资料目录。若目录已存在，会先校验再加载。')),
            h('p', { className: 'cp-muted' }, snapshot.nativeConversationReady ? 'DSH 原生会话已就绪。' : 'DSH 原生会话尚未就绪。'),
            ready && snapshot.storage && h('p', {className:'cp-muted'}, snapshot.storage.complete
              ? '伙伴资料已使用绑定工作区中的持久存储。'
              : '资料文件已准备，但运行存储尚未全部迁入工作区，初始化尚未完成。'),
            snapshot.storage && details('实际存储位置', facts([
              ['Core 当前目录',snapshot.storage.core.current],
              ['Core 工作区目录',snapshot.storage.core.expected || '尚未绑定'],
              ['记忆当前目录',snapshot.storage.memory?.current || '未配置'],
              ['记忆登记目录',snapshot.storage.memory?.configured || '未配置'],
              ['设备运行环境',snapshot.storage.runtime?.python || '未配置'],
            ])),
            walletCapability && facts([['钱包', [capabilityLabels[walletCapability.state] ?? '未知', walletCapability.reason].filter(Boolean).join(' · ')]]),
            saveButton('initialize', Boolean(repo) && !workspaceDirty && !otherWorkspaceDrafts,
              () => save('initialize', { expectedPreferencesRevision: snapshot.preferences.revision }), '检查并初始化资料目录')),
          details('高级执行限制', h('p', { className: 'cp-muted' }, '步数、工具次数和时长只限制自主生活、电视等自动轮次，不限制主人主动对话。模型和工具权限由 DSH 原生会话管理。'),
            fields(...[
              ['maxContextChars', '记忆上下文字符预算', 2048, 128000],
              ['maxSteps', '单次执行步数', 1, 64], ['maxToolCalls', '工具调用次数', 0, 128], ['maxDurationMs', '单次执行时长（毫秒）', 1000, 600000],
            ].map(([key, label, min, max]) => field(label, { type: 'number', min, max, value: draft.conversation[key],
              onChange: value => setDraft(old => ({ ...old, conversation: { ...old.conversation, [key]: value === '' ? '' : Number(value) } })) }))),
            saveButton('preferences', conversationDirty, () => savePreferences('conversation'), '保存执行限制')),
          details('运行状态', h('dl', { className: 'cp-status-list' },
            ...[['core', '核心服务'], ['memory', '记忆'], ['emotion', '情绪'], ['desktop', '桌宠'], ['life', '生活'],
              ['qq', 'QQ'], ['bilibili', '哔哩哔哩'], ['voice', '语音']].map(([owner, label]) =>
              h(React.Fragment, { key: owner }, h('dt', null, label), h('dd', null, capabilityState(owner)))),
            h('dt', null, 'World 基础组件'), h('dd', null, world.size ? '已加载 ' + world.size + ' 项' : '未加载'))),
          details('World 功能的接入情况',
            h('p', { className: 'cp-muted' }, '这里显示大肥鱼使用的组件。独立 World 插件在 DSH 设置中的「世界控制台」管理。'),
            ...worldGroups.map(group => {
              const entries = Object.entries(group.modules);
              const present = entries.filter(([id]) => world.has(id)).map(([, label]) => label);
              const missing = entries.filter(([id]) => !world.has(id)).map(([, label]) => label);
              return h('section', { key: group.id, className: 'cp-world-adoption' }, h('h4', null, group.title),
                present.length > 0 && h('p', null, '已加载 · ' + present.join('、')),
                missing.length > 0 && h('p', null, '未加载 · ' + missing.join('、')),
                present.length > 0 && !missing.length && h('p', { className: 'cp-muted' }, group.connection));
            })));
      }
      function keyDown(event, index) {
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
          : event.key === 'ArrowRight' ? (index + 1) % sections.length
          : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : null;
        if (target === null) return; event.preventDefault(); selectTab(sections[target][0]); tabs.current[target]?.focus();
      }
      if (snapshot?.workspace.state === 'migration-required') {
        const reason = snapshot.workspace.migrationReason;
        return h('div', { className:'chatpet-settings' }, h('style', null, css),
          h(Card, {title:'需要迁移', status:'migration-required'},
            h('p', null, 'DSH 普通聊天仍可使用。'), h('p', null, h('code', null, reason)), h('p', null, snapshot.migrationHelp),
            error && h('p', {role:'alert'}, error),
            h('button', {type:'button', disabled:loading, onClick:refresh}, '刷新设置')));
      }
      return h('div', { className: 'chatpet-settings' }, h('style', null, css),
        h('header',{className:'cp-heading'},h('div',null,h('small',null,'HER WORLD · COMPANION'),h('h2',null,(snapshot?.identity.displayName||'未命名伙伴')+'的世界'),h('div',{className:'cp-state'},h('i',{className:'cp-dot'}),snapshot?snapshot.workspace.state==='ready'&&snapshot.storage&&!snapshot.storage.complete?'存储待迁入工作区':workspaceLabels[snapshot.workspace.state]:'正在连接',snapshot?.preferences.workspace?' · '+snapshot.preferences.workspace.title:'')),dirty&&badge('有未保存修改')),
        h('div', { role: 'tablist', 'aria-label': 'Her World 设置分类', className: 'cp-tabs' }, ...sections.map(([id,title],index) => h('button', {
          key: id, id: `${prefix}-${id}-tab`, type: 'button', role: 'tab', className: 'cp-tab', 'aria-selected': active === id,
          'aria-controls': `${prefix}-${id}-panel`, tabIndex: active === id ? 0 : -1, ref: element => { tabs.current[index] = element; },
          onClick: () => selectTab(id), onKeyDown: event => keyDown(event,index), disabled: Boolean(busy) }, title))),
        error && h('p', { role: 'alert', style: { marginBottom: 16 } }, error),
        notice && h('p', { role: 'status', style: { marginBottom: 16 } }, notice),
        h('fieldset', { disabled: Boolean(busy), style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
          h('div', { id: `${prefix}-${active}-panel`, className:active==='desktop'?'cp-desktop-panel':undefined, role: 'tabpanel', 'aria-labelledby': `${prefix}-${active}-tab`, tabIndex: 0 },
            h(React.Fragment,{key:active},content()),
            appearanceVisited&&h('div',{key:'appearance-'+(snapshot?.workspace.target?.id||'unbound'),className:'cp-appearance',hidden:active!=='desktop'},h(PlatformAppearance,{getEditor:getAppearanceEditor})))),
        h('footer', { className: 'cp-footer' }, h('p', { className: 'cp-muted', role: 'status' }, busy ? '正在保存…' : dirty ? '有尚未保存的修改。关闭设置前请保存。' : '各项设置分别保存。'),
          h('button', { type: 'button', className: 'cp-save', disabled: Boolean(busy) || loading, onClick: refresh }, '刷新设置')));
    }
    function SettingsIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
        h('path', { d: 'M4 6h16M4 12h16M4 18h16' }),
        ...[[9, 6], [15, 12], [9, 18]].map(([cx, cy]) => h('circle', { key: cy, cx, cy, r: 2, fill: 'var(--background, Canvas)' })));
    }
    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        const roomTimeouts = /* room transport */ {"defaultTimeout":15000,"endpoints":{"roomChat":300000,"roomTelevision":300000}};
        const request = async (endpoint, input, signal, requestId) => {
          const controller = new AbortController();
          const abort = () => controller.abort();
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) controller.abort();
          const timer = setTimeout(abort, Object.hasOwn(roomTimeouts.endpoints, endpoint) ? roomTimeouts.endpoints[endpoint] : roomTimeouts.defaultTimeout);
          try {
            const answer = await ctx.connection.rpc.call('/api', `chatpetSettings/${endpoint}`,
              { requestId: requestId || crypto.randomUUID(), input }, controller.signal);
            if (!answer.ok) throw Object.assign(new Error(answer.error.message), { code: answer.error.code });
            return answer.value;
          } catch (failure) {
            if (failure.code && !failure.code.startsWith('gateway/')) throw failure;
            if (['worldView', 'archiveFind', 'archiveRead'].includes(endpoint)) throw new Error('无法读取当前工作区资料，请检查连接后重试。');
            throw new Error(endpoint === 'snapshot' ? '无法读取设置，请检查 00-Core 和连接状态后重试。' : '保存结果未确认，请刷新核对实际状态后再操作。');
          } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
        };
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'her-world', order: 40, label: 'Her World', inject: () => ({ request, getAppearanceEditor:()=>ctx.get?.('chatpetAppearanceEditor') }),
        }, SettingsPage));
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon', id: 'her-world',
        }, SettingsIcon));
      },
    };
  },
});
