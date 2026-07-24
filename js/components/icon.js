// 统一图标组件：<icon name="arrow-right" /> —— 基于 Lucide，替代全站 emoji。
// Lucide 图标数据形如 ["svg", {svg属性}, [ ["path",{d:...}], ... ]]。取 children 转内联 SVG。
const Icon = (function () {
  function toPascal(name) { return String(name || '').replace(/(^|[-_ ])(\w)/g, (_, __, c) => c.toUpperCase()); }
  function toKebab(name) { return String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_ ]+/g, '-').toLowerCase(); }
  function lookup(name) {
    const L = window.lucide; if (!L) return null;
    const pascal = toPascal(name), kebab = toKebab(name);
    const table = L.icons || L;
    return table[pascal] || table[kebab] || L[pascal] || null;
  }
  function attrsStr(a) { return Object.keys(a || {}).map((k) => k + '="' + String(a[k]).replace(/"/g, '&quot;') + '"').join(' '); }
  function extractChildren(node) {
    if (!node) return [];
    if (Array.isArray(node) && node[0] === 'svg') return Array.isArray(node[2]) ? node[2] : [];
    if (Array.isArray(node) && Array.isArray(node[0])) return node;
    if (node.children) return node.children;
    return [];
  }
  function childToSvg(c) {
    if (Array.isArray(c)) return '<' + c[0] + ' ' + attrsStr(c[1]) + ' />';
    if (c && c.tag) return '<' + c.tag + ' ' + attrsStr(c.attrs) + ' />';
    return '';
  }
  return {
    name: 'Icon',
    props: { name: { type: String, required: true }, size: { type: [Number, String], default: 18 }, stroke: { type: [Number, String], default: 2 } },
    computed: {
      svg() {
        const inner = extractChildren(lookup(this.name)).map(childToSvg).join('');
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + this.size + '" height="' + this.size
          + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + this.stroke
          + '" stroke-linecap="round" stroke-linejoin="round" class="lucide">' + inner + '</svg>';
      },
    },
    template: '<span class="ic" v-html="svg"></span>',
  };
})();
