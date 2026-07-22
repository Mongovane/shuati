const APP_VERSION='v103'; // 与 sw.js 的 VERSION 同步升级；用于界面显示与排查缓存
const SUBJECTS=[{v:'politics',t:'政治理论'},{v:'english',t:'英语'},{v:'math',t:'高等数学'},{v:'computer',t:'计算机基础与程序设计'}];
const CHAPTER_PRESETS={
  politics:['马原-唯物论','马原-辩证法','马原-认识论','马原-唯物史观','毛中特','习近平新时代中国特色社会主义思想','近代史纲要','思修法基','时政'],
  english:['英语-词汇语法','英语-阅读理解','英语-完形填空','英语-翻译','英语-写作','英语-固定搭配','英语-长难句'],
  math:['高数-函数与极限','高数-连续','高数-导数与微分','高数-中值定理','高数-导数应用','高数-不定积分','高数-定积分','高数-微分方程','高数-多元函数','高数-级数'],
  computer:['计算机基础-信息技术基础','计算机基础-操作系统','计算机基础-Office','计算机基础-网络基础','C语言-基础语法','C语言-选择结构','C语言-循环结构','C语言-数组','C语言-函数','C语言-指针','C语言-结构体','C语言-文件','数据结构-线性表','数据结构-栈和队列','数据结构-树','数据结构-图','数据结构-查找','数据结构-排序']
};
const SUBJ_MAP=Object.fromEntries(SUBJECTS.map(s=>[s.v,s.t]));
const TYPES=[{v:'single_choice',t:'单选题'},{v:'multiple_choice',t:'多选题'},{v:'true_false',t:'判断题'},{v:'fill_blank',t:'填空题'},{v:'short_answer',t:'简答题'},{v:'code',t:'编程题'}];
const TYPE_MAP=Object.fromEntries(TYPES.map(t=>[t.v,t.t]));
// 教材阅读已改为「智能导入」产出的动态资料（D1 materials 表），不再依赖仓库里的静态 PDF。
const OBJECTIVE=['single_choice','multiple_choice','true_false','fill_blank'];
const AUTO=['single_choice','multiple_choice','true_false'];
