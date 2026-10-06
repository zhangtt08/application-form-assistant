import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateProfile} from '../src/profile/schema.ts';
import {curateProjects} from './curate-projects.mjs';

const ROOT='C:/Users/Administrator/Desktop/47.104.175.233';
const OUT=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
const here=decodeURIComponent(OUT);
const load=async n=>import(pathToFileURL(`${ROOT}/src/data/${n}.js`));
const {productProjects}=await load('productProjects');
const {projectCases}=await load('projectCases');
const {motionProjects}=await load('motionProjects');
const {visualProjects}=await load('visualProjects');
const {musicProjects}=await load('musicProjects');
const {caseEditorial}=await load('caseEditorial');
const num=a=>a.filter(Boolean).map((t,i)=>`${i+1}. ${t}`).join('\n');
const zh=x=>typeof x==='string'?x:Array.isArray(x)?x.map(zh).filter(Boolean).join('；'):x?.zh||'';
const clean=t=>t.replace(/\*\*/g,'').replace(/\s*\n\s*/g,' ').trim();
const list=x=>Array.isArray(x)?x:x?[x]:[];
const detail=x=>[zh(x.summary),zh(x.problem),...((x.detailSections||[]).flatMap(s=>[zh(s.body),...(s.bullets||[]).map(zh)])),...(x.keyFunctions||[]).map(zh)].map(clean).filter(Boolean);
const sources=[];
function entry(id,name,dates,background,points,results,keywords,role='独立开发',extra={}){
  sources.push({id,name,sources:extra.sources||[],datePrecision:dates.join(' - ')||'未确认',notes:extra.note||''});
  return {id,name,role,startDate:dates[0]||'',endDate:dates[1]||'',background:num([background]),points,results,keywords,...extra};
}
const catalog=[];
const put=(...a)=>{const p=entry(...a);catalog.push(p);return p;};
put('enterprise','达人广告素材全链路自动化系统',['2026.07','2026.10'],'企业真实生产场景：多平台、多账号、多项目素材处理分散，下载、匹配、标注及送审依赖重复人工操作。入职前已有特定项目的自动打标程序，本项目为独立构建当前工作所用的全流程系统，不等同重建公司全部历史平台。',[
 '业务发现与优先级规划：上手一线工作后，两天内整理人工 SOP、关键判断条件与需求清单，结合使用频率、人工耗时、可行性和实现成本，从高性价比环节逐步推进，而非先攻最复杂的技术问题。',
 '接口化改造：从双账号数据导出切入，将多浏览器登录、账号切换与手动排队下载整合为桌面工具；通过后台业务接口获取数据，并将人工下载与工具输出逐项对照验证。大体量导出环节由约 1–2 小时缩短至约半小时。',
 '全链路构建：通过 Agent 辅助开发实现素材下载、跨表数据匹配、自动标注、结果整理及审核送审 5 个核心环节，串联 4 个业务平台；优先使用 API，对无合适接口的页面采用 Playwright 或基础 RPA。',
 '模块化工具后端：将自研业务功能与 Python 脚本整理为 36 个启用业务脚本，通过 MCP 向 ZTT Code 提供统一调用入口；工具后端负责确定性执行，Agent 客户端负责模型判断与任务编排。36 是业务脚本数量，不与其他检索或管理工具混算。',
 '经验结构化：与素材管理、达人运营和媒介协同，将常见素材配套关系、文件名与 Excel 字段判断依据、Brief、标签标准和边界案例转为 Prompt、规则文档及可复用 Skill，而非开展模型微调。',
 'RAG 与项目隔离：借助 Agent 完成文档切分、Embedding 与向量检索，按项目隔离规则知识；Agent 运行时检索对应规则并保留来源。新规则更新知识库即可适配，无需重新修改主业务流程。',
 '混合执行与质量兜底：规则明确的任务优先用确定性程序；规则未命中、多标签冲突或低置信度情况进入模型判断或人工处理。通过人工已匹配样本对照、随机抽检及审核反馈回溯，持续调整规则与 Prompt。',
 '可靠运行与推广：完善自动重试、断点续跑、运行状态提示、输出结果检查和人工处理入口；提供内置规则、操作教程并现场排查启动环境、账号登录态等问题，使小组成员可以独立使用。',
 '送审链路升级：将早期逐批 RPA 送审改为 API 接口化，该环节单次约 2–3 小时缩短至约 5 分钟。该指标仅指批量送审，不与素材下载或全流程时长混用。'
 ],[
 '同范围的下载、标注、整理和送审任务，单人纯人工基线约 500 条/日，自动化日常约 6000+ 条/日，处理产能约为原基线 12 倍。',
 '峰值处理 1 万+ 条/日、累计处理 30 万+ 条；完整日常任务全流程约 1.5 小时，人工操作低于 5 分钟。',
 '通过随机人工抽检、误判回溯与规则迭代，判断准确率由首版约 70% 提升并稳定在 90%+；不将近期少报错直接当作全量 95% 准确率。',
 '投入 3–5 人业务小组日常生产，支撑 5+ 真实项目，释放产能承接约 3 个新增项目。'
 ],['AI 应用','业务自动化','MCP','RAG','Prompt','Skill','Playwright','流程分析','跨业务协作'],'AI 应用开发｜业务流程自动化',{sources:['src/data/productProjects.js#chameleon-labeling-workflow','src/data/productProjects.js#ztt-code','最新简历与本人业务口径确认']});

const overrides={
 'ztt-code':{dates:['2026.07','2026.10'],name:'ZTT Code｜企业素材管理 Agent',points:[
 '面向业务人员自然语言描述任务的使用方式，独立构建桌面 Agent 入口，将对话推理、规则检索和工具执行分层，避免将所有业务逻辑堆入单个 Prompt。',
 '以 Tauri、React 与 Python 承载桌面交互与工具循环，通过 MCP 调用自研工具后端；客户端选择工具并读取结果，工具后端不直接调用大模型。',
 '结合自然语言、文件名和 Excel 字段识别 5+ 项目类型，按对应知识库检索规则并选择工具及固定工作流；执行链路为任务识别 → RAG 规则检索 → Tool Routing → Agent Loop → 结果校验 → Human-in-the-loop。',
 '支持单环节调用与完整日常流程调用，展示运行状态并保留规则来源；异常时检索已有规则和 Skill 辅助定位，无法验证的情况请求人工处理。',
 '结合小组反馈优化任务入口、工具参数和操作说明；规则与执行程序分开维护，减少新规则引发的重复脚本修改。'
 ],results:['已与企业全链路工具系统共同投入业务使用；客户端与后端属于同一生产方案，处理规模及效率结果不重复累加。']},
 'tcode':{dates:['2026.08','2026.10'],points:[
 '构建个人自然语言执行入口，接入已登记的个人项目与工具能力，不限于素材下载、链接解析或音频处理等几个单点工具；按任务查询项目状态并选择实际可用接口。',
 '以 Node.js 本机服务与 WinForms / WebView2 桌面壳承载对话、检索及执行；当前目录登记 14 个项目、24 个工具，并按白名单区分读取、写入和执行。',
 '将个人资料、项目 README 与交接文档建立 BM25 检索索引，回答附文件与行号；个人事实修改采用预览后确认提交，避免对话内容自动覆盖资料。',
 '实现多轮 Agent Loop、同轮工具并行、重复调用缓存、步骤清单及工具结果回填；结合历史折叠、摘要与结果长度控制管理上下文预算。',
 '集成持久会话、长期记忆、提醒、模型提供方切换及备用模型降级；通过 SSE 展示执行进度，并保留工具调用、耗时及 Token 使用记录。',
 '接入 WorkflowHub，采用搜索 → 查看契约 → 调用的方式使用本机能力，避免将全部工具 schema 一次塞入上下文；破坏性命令由硬规则拦截。'
 ],results:['形成日常使用的个人 Agent 工作台，能够按对话调用已接入项目接口与工具；项目服务可访问是实际调用的前提。','实现资料检索、工具执行、会话和记忆的统一入口，而非仅提供聊天界面。']},
 'agentcut':{dates:['2026.10','2026.10'],points:[
 '识别传统剪辑软件缺少稳定 Agent 操作接口的问题，独立构建人和 Agent 共用同一时间线的本地剪辑产品，以 Electron / React 桌面端配合 Python、FFmpeg 引擎及 HTTP / MCP。',
 '统一界面与 Agent 的批命令语义，采用原子事务、request_id 幂等回执、expected_revision 校验及 dry-run，防止重复提交和并发覆盖。',
 '实现真实素材探测、时间线拖拽与修剪、分割、关键帧、曲线变速、字幕导入、转场、遮罩及嵌套合成；素材与工程按统一契约管理。',
 '支持每通道曲线、白平衡、RGB 增益和串行调色节点；以同源参数驱动预览与 FFmpeg 导出，并通过真实像素、时长和音画同步验证，而非只检查界面。',
 '实现 EBU R128 响度检测与统一、静音检测去空白、配乐自动闪避、代理回放和缓存配额；按场景改善口播及多素材制作效率。',
 '渲染绑定固定版本并进入持久任务队列，支持取消、多画幅批量交付、历史快照恢复和素材工程打包；已交付可运行桌面程序。'
 ],results:['形成有实际媒体处理与导出验证的桌面剪辑软件，界面、HTTP 和 MCP 共用规则。','不将未实现的自动语音字幕、多目标跟踪或完整节点调色图写成已完成，不声称全面替代 AE 或达芬奇。']},
 'workflowhub':{dates:['2026.10','2026.10'],results:['已交付本地桌面软件，统一发现、检索和调用本机工具，并与 Tcode 对接；发现条目数量随机器环境变化，不作为固定个人开发数量。']},
 'trendscope':{dates:['2026.08','2026.10'],results:['形成可使用的热点入库、趋势判断与选题工作台；不同平台采集能力和登录条件分别管理。','实际使用中通过榜单增长与推荐信号发现“时代俊峰／重庆”事件，人工检索确认发酵阶段后形成选题，相关原创视频最高近 50 万播放；不将一次案例写成预测准确率。']},
 'ztt-geo':{dates:['2026.09','2026.10'],results:['形成基于品牌事实、证据、内容简报和渠道适配的 GEO 工作台及桌面交付物。','工具支持内容核对与发布记录，但不将已实现连接器等同于所有渠道已实际投放，也不编造客户获客或业务转化。']},
 'portfolio-assistant':{dates:['2026.05','2026.10'],results:['公开作品集 AI 助手已上线，访客可通过自然语言检索作品、经历和联系信息；不读取个人 Tcode 的私有记忆。']},
 'recorded-automation':{dates:['2026.10','2026.10']},
 'multi-agent-orchestrator':{dates:['2026','2026'],note:'具体月份未确认；个人协作研究项目，不作为企业稳定生产成果。',results:['形成多 Agent 执行、独立验收与交接的个人探索项目；不宣称已在企业长期无人值守稳定运行。']},
 'agent-context-bridge':{dates:['2026','2026'],note:'具体起止月份未确认，未用文件迁移时间推断开发日期。'},
 'ai-project-commander':{dates:['2026','2026'],note:'具体起止月份未确认。'},
 'shengxi-audio-separator':{dates:['2026','2026'],note:'原简历给出综合工具开发起点 2026.05，单个软件起止月份未单独确认。'},
 'qingying-downloader':{dates:['2026','2026'],note:'综合工具开发起点不等于单个软件起点，具体月份待确认。'},
 'material-downloader':{dates:['2026','2026'],note:'综合工具开发起点不等于单个软件起点，具体月份待确认。'},
 'frameboost':{dates:['2026','2026'],note:'具体起止月份未确认。'}
};
for(const x of productProjects){
 if(['chameleon-labeling-workflow','biaoxu-material-workbench','xingguang-video-collector','xingtu-data-export','api-scout','api-hunter'].includes(x.id))continue;
 const o=overrides[x.id]||{};
 const ds=(x.detailSections||[]).flatMap(s=>[zh(s.body),...(s.bullets||[]).map(zh)]).filter(Boolean);
 let pts=o.points||ds;
 if(pts.length<4)pts=[...pts,...(x.keyFunctions||[]).map(f=>`功能落地：${zh(f)}。`)];
 if(!pts.length)pts=detail(x);
 put(x.id,o.name||zh(x.indexTitle)||zh(x.title),o.dates||['2026','2026'],zh(x.problem)||zh(x.summary),pts,o.results||[zh(x.result)||`已形成${zh(x.form)||'本地工具'}及网站项目展示，具体功能以源码和项目文档中的实现范围为准。`],(x.method||[]).map(zh),'独立开发',{sources:[`src/data/productProjects.js#${x.id}`,`项目目录／README 与技术说明`],note:o.note||''});
}
put('website','个人作品集网站与 SEO / GEO 实践',['2026.05','2026.10'],'作品、经历和项目分散，原 IP 网站不易被搜索引擎抓取，需要建立可检索、可引用的个人作品与能力入口。',[
 '独立完成个人网站定位、信息架构、视觉语言、作品分类、项目案例页及交互逻辑，并借助 Agent 开发、部署服务器和持续迭代。',
 '配置 zhangtianteng.xyz 独立域名，完善爬虫可访问的公开内容、索引入口及搜索引擎提交；将个人身份、项目说明和作品信息统一到可核实的页面。',
 '围绕复杂页面状态处理导航、返回来源恢复、响应式布局、多语言与 ESC 行为，使不同媒介作品可以在统一体验内浏览。',
 '内置基于公开资料检索和白名单工具调用的 AI Assistant，以 SSE 返回回答，限制请求、历史与输出长度，对资料覆盖不足的问题明确拒绝。',
 '使用本人姓名进行独立搜索验证：Google 搜索“张天腾”可出现个人网站首位结果；ChatGPT 在未预先提供域名的条件下可检索网站并引用准确信息。',
 '区分技术可抓取、实际收录和生成式搜索引用三个阶段；搜索排名为本人测试时的结果，不承诺所有地区、账号与后续时间始终第一。'
 ],['网站与公开 AI 助手已部署上线。','完成域名、索引及姓名检索验证，形成 SEO / GEO 的个人实证案例，不编造流量、转化率或客户营收。'],['SEO','GEO','网站产品','信息架构','RAG','AI Assistant'],'产品设计与独立开发',{sources:['网站源码 src/data 与 _server','个人 SEO / GEO 检索验证确认']});
put('afa','Application Form Assistant｜网申资料库与自动填写助手',['2026','2026'],'网申系统字段命名、页面结构和岗位要求各不相同，重复填写且需要在不同经历表述之间切换。',[
 '独立构建基于 Manifest V3 的 Edge 插件，以 TypeScript、React 与 Vite 实现侧边栏、内容脚本和本地资料管理，资料不依赖外部云端存储。',
 '设计共享基本信息与分岗位资料库：教育及联系信息全库共用，经历、项目、技能和自我介绍按岗位定制；同一条经历支持短、中、长描述及职责、工作内容和成果语义槽位。',
 '结合网页标签、上下文、字段别名、区块类型与置信度识别表单，不将搜索框、登录、密码或不确定敏感字段当作可随意填写的求职字段。',
 '针对 React 等受控输入、下拉框、重复经历区块、iframe 和 Shadow DOM 等复杂页面设计写入与验证逻辑；不确定项保留人工处理，而非强行填写。',
 '通过岗位方向识别选择资料库，并在字段预算内取用合适表达，减少将完整长文硬塞入短字段的风险；支持 JSON 导入、结构校验和保存。',
 '建立字段匹配、框架输入、兼容与隐私回归测试，保留结果确认、失败反馈和本地日志；自动填写与最终提交分离，不自动代用户提交申请。'
 ],['形成可在 Edge 中使用的本地网申助手及多资料库机制。','本次资料库即按该产品的原生 Profile 与 LibraryStore schema 生成并校验，属于实际功能使用，不等同所有招聘站点均已验证兼容。'],['Edge 插件','TypeScript','React','表单语义识别','产品设计','岗位资料库'],'独立产品设计与开发',{sources:['application-form-assistant/src/types/profile.ts','src/profile/libraryStore.ts','src/profile/schema.ts','项目 agent 文档'],note:'开发起止月份未确认，暂保留年度精度。'});

const creative=[];
function creativePut(...a){const p=put(...a);creative.push(p.id);return p;}
creativePut('growth','短视频内容增长与账号运营',['2024.09','2026.10'],'通过个人短视频账号验证选题、受众切入和内容表达，形成从趋势发现到发布复盘的完整创作实践。',[
 '独立运营 4 个短视频账号，覆盖 AI 视觉、动漫、个人兴趣与社会热点，负责热点判断、选题、素材搜集、剪辑包装、标题及账号发布。',
 '使用 TrendScope 榜单的增长及推荐信号发现正在发酵的话题，再人工检索事件与受众反馈，判断是否适合创作，避免直接照搬榜单。',
 '针对“时代俊峰／重庆”事件，在核实发酵阶段后选择明确的受众视角形成视频选题，约 1–2 小时完成相关内容。',
 '结合播放、互动、评论反馈迭代选题与表达；将数据表现视为内容验证，而非简单把播放增长全部归因于 AI 工具。'
 ],['单条最高近 50 万播放、约 3 万点赞、近 1 万评论、1.6 万转发。','累计 5 条作品播放量超过 1 万；上述数据来自个人原创内容，不包装成 AIGC 广告投放效果。'],['内容运营','用户洞察','热点判断','选题','数据复盘'],'独立创作者',{sources:['最新简历','本人 TrendScope 热点创作案例确认','网站 motionProjects.js']});
for(const id of ['aigc-code-showreel','aigc-camera-aperture','aigc-luckin-coconut-latte','aigc-last-cookie','heytea-aigc-posters','aigc-star-on-the-way-home','aigc-red-satchel','aigc-maison-caramel']){
 const x=motionProjects.find(p=>p.id===id);if(!x)continue;
 const points=[`创意与结构：${zh(x.storyline)||zh(x.context)||zh(x.projectTitle)}`,`画面与表达：${zh(x.visualStructure)||'围绕主题确定视觉结构与观看节奏。'}`, ...(list(x.productionNotes).map(zh)), ...(list(x.sequence).map(s=>typeof s==='string'?s:zh(s.description)||zh(s.body)||zh(s.title)||zh(s.note)))].filter(Boolean);
 if(id==='aigc-code-showreel')points.push('基于日常 After Effects 使用经验提出动效创意与脚本，借助 Agent 生成 JavaScript 动画并直接渲染视频；多个物体采用不同动画与转场，约 1 小时完成较高完成度的成片，区别于直接调用视频生成模型。');
 const docs=points.filter(p=>p&&!p.endsWith('：'));
 if(id==='aigc-camera-aperture')docs.push('产品信息转译：以光圈结构、拍摄参数和夜景效果的对照组织技术卖点，让画面承担解释功能，兼顾产品表达和视觉可读性。','制作与展示：完成约 87 秒产品主题成片，按结构说明、实际效果和参数回收组织观看路径，可用于展示产品内容创意与镜头表达能力。');
 if(id==='aigc-luckin-coconut-latte')docs.push('广告表达：围绕饮品产品与场景感建立短片内容，以约 30 秒时长组织视觉吸引、产品呈现与收束，作为自主品牌概念作品展示。');
 if(id==='aigc-code-showreel')docs.push('能力边界判断：以 AE 使用经验判断生成动画的完成度，负责创意、脚本和成片判断，代码和渲染执行由 Agent 辅助完成，体现从传统动效需求到程序化视觉表达的迁移。');
 creativePut(id,zh(x.title),['',''],`个人 AIGC 创作作品，${x.duration?`片长约 ${Math.round(x.duration)} 秒。`:''}品牌题材为自主概念表达，不作为商业品牌委托。`,docs,[`已形成可在作品集查看的成片：${zh(x.title)}。`],['AIGC','创意脚本','视觉叙事','视频制作'],'创意策划与独立创作',{sources:[`src/data/motionProjects.js#${id}`],note:'该子作品独立开发月份未确认，不将上传日期当创作起点；综合创作实践起始于 2024.09。'});
}
for(const [series,items] of Map.groupBy(visualProjects,x=>x.series)){
 const desc=items.map(x=>`${zh(x.title)}：${zh(x.description)}`);
 creativePut(`visual-${series}`,`AIGC 系列海报｜${series}`,['',''],'个人 AIGC 视觉与版式创作，将主题、产品形象和传播文案转化为系列海报；非品牌委托作品。',[
 `系列规划：${desc[0]}`,...desc.slice(1),
 '围绕系列主题组织主视觉、色彩、产品与文案的阅读层级，并结合图像生成及后期排版形成可展示作品；不将生成图片本身等同摄影作品。'
 ],[`网站当前该系列展示 ${items.length} 幅海报，可逐幅查看视觉成果。`],['AIGC 海报','视觉设计','品牌表达','文案'],'视觉创意与独立制作',{sources:[`src/data/visualProjects.js#${series}`],note:'系列创作月份未确认；不使用宽泛综合内容创作起点代替单个系列日期。'});
}
creativePut('aigc-music','AI 音乐与音画叙事创作',['',''],'将歌词、音乐风格和视频节奏结合，用生成式音频补充内容表达，而非仅罗列音频工具名称。',musicProjects.map(x=>`${zh(x.title)}：${zh(x.description)} ${zh(x.making)}`),['网站展示《今天也在学习你呀》《AI 今天也上线啦》《还在生成》与 Popup 四个音频作品；其中同名 AMV 对应歌曲，Popup 为 30 秒 BGM。'],['Suno','生成式音乐','风格 Prompt','音画节奏'],'独立创作',{sources:['src/data/musicProjects.js'],note:'独立创作月份未确认。'});
creativePut('city-film','城市影像与摄影后期',['2024.09','2026.10'],'以真实拍摄积累镜头、构图、节奏和调色经验，补充 AI 视觉创作的审美与后期判断。',[
 '独立完成上海与重庆城市影像的拍摄、素材筛选、剪辑及调色，在作品集以 CITY FILM 和摄影分类展示。',
 '结合 Premiere Pro、After Effects、剪映和 Lightroom 处理剪辑节奏、音画关系与基础色彩，区分实拍作品与生成式图像。',
 '将活动摄影和个人影像经验迁移到品牌内容的画面组织、素材选择和后期表达。'
 ],['已形成可查看的城市短片及真实摄影作品；不编造商业摄影客户或销量。'],['摄影','构图','Lightroom','视频后期'],'拍摄与后期',{sources:['src/data/motionProjects.js#photo-01','src/data/photoProjects.js']});
const brand=[];
for(const x of projectCases){
 const ed=caseEditorial[x.slug]||Object.values(caseEditorial).find(e=>zh(e.title)===zh(x.title))||{};
 const points=[`独立策划提案：${zh(ed.brief)||zh(x.summary)}；预算与指标为方案计划／测算。`,`人群与洞察：${zh(ed.insight)||zh(x.summary)}`,`策略与创意：${zh(ed.decision)||zh(x.summary)}`,`执行设计：${zh(ed.execution)||zh(x.description)}`,`提案交付：${zh(x.description)}`];
 const p=creativePut(`brand-${x.id}`,`${zh(x.brand)}｜${zh(x.title)}`,x.year?[String(x.year),String(x.year)]:['',''],'独立广告／品牌策划提案。方案中的预算、曝光、销量、转化和执行节奏均为计划或测算，不作为已执行的商业结果。',points,
 [`形成${x.pageCount?` ${x.pageCount} 页` :''}可在网站查看的策划方案与视觉呈现。`],['广告策划','用户洞察','品牌策略','内容规划','传播路径','预算测算'],'独立策划',{sources:[`src/data/projectCases.js#${x.id}`,'src/data/caseEditorial.js'],note:'具体策划日期未确认；保持原综合实践时间范围，不为单篇提案编造月份。'});brand.push(p.id);
}

function normalize(p,track){
 const lens={app:'侧重可用软件、Agent 工具接入、确定性执行与业务问题解决。',aigc:'侧重内容创意、视觉与声音表达、素材组织及创作流程效率。',ops:'侧重需求识别、用户工作流程、数据反馈、可验证的运营结果和持续迭代。'};
 const polished=t=>t.replace(/；不将近期少报错直接当作全量 95% 准确率。/g,'。').replace(/；不将一次案例写成预测准确率。/g,'。').replace(/，不编造流量、转化率或客户营收。/g,'。').replace(/，不包装成 AIGC 广告投放效果。/g,'。').replace(/，20 条是月均工作量，不是实习总交付。/g,'。').replace(/；上述为内容与活动工作量，不写成获客结果。/g,'。').replace(/；没有虚构活动数量或获奖。/g,'。').replace(/，不以模糊结论冒充已完成。/g,'。');
 let pts=p.points.map(polished);
 const results=p.results.map(polished);
 if(p.id==='enterprise'&&track==='aigc')pts=[
 '业务场景：日常素材管理涉及大量 AIGC 视频与达人广告内容；负责的是素材获取、分类标注及交付流程，不冒充在该岗位直接制作或剪辑全部 AIGC 成片。',...pts];
 if(['enterprise','selected-enterprise'].includes(p.id)&&track==='ops')pts=[pts[0],pts[4],pts[7],...pts.filter((_,i)=>![0,4,7].includes(i))];
 const core={name:p.name,role:p.role,startDate:p.startDate,endDate:p.endDate,keywords:p.keywords,
 background:p.background,responsibilities:num([`${p.role}：承担该项目的需求理解、方案组织与实际落地。`,...pts.slice(0,3)]),workContent:num(pts),achievements:num(p.results),summary:num([p.name,...p.results.slice(0,2)]),
 descriptionShort:num([`${p.name}：${p.points[0]||p.background.replace(/^1\. /,'')}`,results[0]]),
 descriptionMedium:num([...pts.slice(0,3),...results.slice(0,2)]),
 descriptionLong:num([...pts,...results.map(t=>`成果与验证：${t}`)]),variants:{}};
 core.achievements=num(results);core.summary=num([p.name,...results.slice(0,2)]);
 for(const [key,t]of Object.entries({agent:'app',aiApplication:'app',aiSolution:'app',aiProduct:'ops',aiOperation:'ops',aigcMarketing:'aigc'})){
 const ps=(p.id==='enterprise'&&t==='ops')?[p.points[0],p.points[4],p.points[7],p.points[2]]:t==='aigc'&&p.id==='enterprise'?['围绕包括 AIGC 视频在内的达人广告素材，改造素材管理、分类和交付流程；此岗位的创作优势体现为理解视频内容与生产需求，不声称负责全部成片制作。',p.points[2],p.points[5],p.points[7]]:p.points.slice(0,4);
 core.variants[key]=num([...ps.map(polished),...results.slice(0,2)]);
 }
 if(p.id==='selected-enterprise'&&track==='ops'){
   core.name='企业素材业务数字化与 Agent 自动化落地';
   core.role='业务需求分析｜流程产品化与应用推广';
 }
 return core;
}

const basic=Object.fromEntries(['name','englishName','surname','givenName','linkedin','github','gender','birthDate','age','phone','email','wechat','qq','city','portfolio','address','idNumber','nativePlace','hukou','hukouType','politicalStatus','maritalStatus','height','weight','workYears','emergencyContactName','emergencyContactPhone'].map(k=>[k,'']));
Object.assign(basic,{name:'张天腾',englishName:'Zhang Tianteng',surname:'Zhang',givenName:'Tianteng',github:'https://github.com/zhangtt08',gender:'男',age:'21',phone:'15330332970',email:'994605656tt@gmail.com',city:'重庆市',portfolio:'https://zhangtianteng.xyz'});
const education=[{school:'重庆交通大学',college:'旅游与传媒学院',major:'广告学',degree:'本科',degreeType:'',educationLevel:'本科',direction:'广告学／新媒体内容与品牌传播',startDate:'2023.09',endDate:'2027.07',gpa:'3.37',rank:'31'}];
const sensitive={politicalStatus:'',maritalStatus:'',idNumber:'',emergencyContact:''};
const internshipFacts=[
 {company:'优矩互动科技有限公司',department:'星广孵化',position:'AI 应用开发｜业务流程自动化',startDate:'2026.07',endDate:'2026.10',p:catalog.find(p=>p.id==='enterprise')},
 {company:'重庆青天特克科技有限公司',department:'',position:'短视频剪辑与运营',startDate:'2026.03',endDate:'2026.07',p:entry('intern-video','短视频剪辑与运营',['2026.03','2026.07'],'仪器仪表行业的销售口播、科普与信息流内容制作及账号日常运营。',[
 '内容制作：负责素材整理、粗剪与精剪、字幕包装、音效处理、基础视觉包装及封面，围绕产品信息与目标受众提升表达清晰度。',
 '账号协作：参与选题策划、内容排期、日常发布及账号维护，协调素材、交付节奏和不同内容形式。',
 '数据复盘：结合播放量、完播和互动数据辅助调整选题、内容结构及剪辑节奏，不夸大成独立负责全账号增长。',
 '创作能力：将传统剪辑经验用于判断 AIGC 素材是否可用、动效表达是否清楚，以及后期音画衔接。该迁移能力不等同在这段实习实际负责 AIGC 系统开发。'
 ],['保持约 5 条/周、20 条/月的短视频制作节奏，20 条是月均工作量，不是实习总交付。'],['视频制作','内容运营','数据复盘'],'短视频剪辑与运营')},
 {company:'重庆蔡同水务有限公司',department:'',position:'品牌专员',startDate:'2026.01',endDate:'2026.03',p:entry('intern-brand','品牌传播',['2026.01','2026.03'],'企业日常品牌传播与会议活动内容支持。',[
 '整理企业微信公众号选题与素材，完成图文编辑、新闻稿整理、排版及发布。',
 '参与会议及企业活动现场摄影，筛选照片并进行基础后期，使素材适合新闻和品牌传播使用。',
 '按内容用途整理和归档品牌资料，支持后续重复使用及日常传播需求。'
 ],['完成约 10 篇微信公众号及新闻内容编辑与排版。','参与 10+ 场会议及活动摄影；上述为内容与活动工作量，不写成获客结果。'],['品牌传播','摄影','图文编辑'],'品牌专员')}
];
const campusFacts=[
 {organization:'重庆交通大学',department:'广告学班级',position:'学习委员',startDate:'2023.09',endDate:'2025.03',p:entry('campus-study','学习委员',['2023.09','2025.03'],'班级教学信息与学习事务协调。',['对接老师与同学，整理课程信息、作业安排和学习反馈。','组织 27 人班级的学习事务，协调 10+ 门课程相关信息与需求。','通过明确任务、及时沟通和信息归档降低重复传达成本，积累多方协作经验。'],['形成持续的课程协调与班级信息组织实践。'],['沟通协调','信息管理'],'学习委员')},
 {organization:'重庆交通大学青年志愿者协会',department:'宣传部',position:'宣传部干事',startDate:'2023.09',endDate:'2025.06',p:entry('campus-youth','青年志愿者协会宣传',['2023.09','2025.06'],'校内外志愿活动的图文与影像传播。',['参与志愿活动宣传，负责现场拍摄、素材筛选和微信公众号选题采编。','完成活动图文排版与发布，组织活动信息并整理可复用图片资料。','结合活动主题和受众选择照片与文字，支持志愿服务信息传播。'],['积累活动摄影、图文编辑与团队宣传协作经验；没有虚构活动数量或获奖。'],['志愿宣传','摄影','公众号'],'宣传部干事')}
];
const toExperience=(x,t,isCampus=false)=>{const p=normalize(x.p,t);delete p.name;delete p.role;delete p.keywords;delete p.background;return {...p,...Object.fromEntries(Object.entries(x).filter(([k])=>k!=='p'))};};
const skillBase={
 ai:'AI 应用与 Agent：具备业务规则转化、Prompt / Skill 设计、RAG 文档切分与检索、Embedding、Vector Search、Tool Calling、MCP、Tool Routing 和 Agent Loop 项目实践；企业工具执行和模型判断分层。',
 code:'Agent 辅助开发 / Vibe Coding：使用 Claude Code、Codex、Cursor 等工具完成需求拆解、方案设计、Demo、开发测试与迭代；所有个人项目为独立主导，具体代码由 Agent 辅助实现，不自称传统高级程序员。',
 auto:'自动化与技术基础：具备 Python 基础和脚本修改实践，使用过 Playwright、REST API、影刀 RPA、FFmpeg 及文件批处理；能根据确定性、维护成本和场景选择接口、网页或模型方案。',
 data:'Excel / 飞书多维表格：熟悉 Excel 函数、跨表匹配与批量处理，以及飞书多维表格的关联记录、自动化、视图、筛选、权限及图表配置；具备日均数千条业务数据处理与状态管理经验。',
 product:'产品与流程：具备 SOP 梳理、需求抽象、优先级规划、功能清单、反馈回溯、操作说明、试用推广与持续迭代实践，能通过亲自使用发现低效环节并转化为可用工具。',
 visual:'视频与影像：熟练使用 Premiere Pro、After Effects、剪映，熟悉 Lightroom；具备口播、信息流、城市影像、活动摄影、音效与视觉包装经验。',
 aigc:'AIGC 创作：使用 Pavo AI、Midjourney、Suno、Fish Audio 等平台／工具，以及 Seedance、Veo、MiniMax、Nano Banana、GPT Image 等模型进行图像、视频或音频实践；不将接触过的模型全部写成精通。',
 marketing:'内容与品牌：具备受众洞察、热点核实、选题策划、系列内容、发布与复盘能力；品牌策划可覆盖创意概念、渠道路径、活动方案、预算测算与风险预案。',
 geo:'SEO / GEO：具备域名配置、公开页面与索引优化、搜索引擎提交、姓名检索与 AI 引用验证实践；能区分方案、实际收录、引用和商业转化，不混用结果口径。'
};
const tracks={
 app:{name:'AI 应用｜业务自动化｜解决方案',dirs:['aiApplication','agent','aiSolution'],positions:['AI 应用开发','业务自动化','AI 解决方案','AI 产品助理'],ids:['enterprise','ztt-code','tcode','workflowhub','agentcut','afa','agent-context-bridge','ai-project-commander','multi-agent-orchestrator','portfolio-assistant','website','trendscope','ztt-geo','frameboost','shengxi-audio-separator','qingying-downloader','material-downloader'],skills:['ai','auto','code','product','data','geo','visual'],intro:[
 '我是重庆交通大学广告学 2027 届本科生，核心优势是识别真实业务中的低效流程，并借助 Agent、规则设计和自动化把人工经验转化为实际可用的软件。',
 '在优矩互动从一线素材工作切入，独立梳理 SOP、按业务频率与成本安排功能优先级，逐步构建跨 4 个平台的素材处理系统，现投入 3–5 人小组使用并支撑 5+ 项目。',
 '在同范围任务下，处理产能由单人纯人工约 500 条/日提升为自动化日常 6000+ 条/日；全流程约 1.5 小时、人工操作低于 5 分钟，并保留抽检、异常回溯和人工兜底。',
 '个人项目覆盖企业 Agent、Tcode、工具发现与编排、人机共用剪辑台、上下文交接及网申助手；不仅做单点 Demo，也关注接口契约、执行回执、部署使用和反馈迭代。',
 '具备 Python 基础，通过 Vibe Coding 与 Agent 辅助实现项目；广告学与内容制作背景使我更重视用户任务、可理解的产品入口和真实使用效果。'
 ]},
 aigc:{name:'AIGC 创作｜视觉内容｜创作工具',dirs:['aigcMarketing'],positions:['AIGC 内容创作','AIGC 视频制作','AI 视觉创意','创意策划','视频剪辑'],ids:['aigc-code-showreel','aigc-camera-aperture','aigc-luckin-coconut-latte','aigc-last-cookie','heytea-aigc-posters','aigc-star-on-the-way-home','aigc-red-satchel','aigc-maison-caramel','aigc-music','city-film',...creative.filter(id=>id.startsWith('visual-')),...brand,'agentcut','frameboost','shengxi-audio-separator','material-downloader','qingying-downloader','enterprise','growth','website'],skills:['aigc','visual','marketing','code','auto','product','data'],intro:[
 '我是重庆交通大学广告学 2027 届本科生，具有传统剪辑、视觉创意、AIGC 内容与自研创作工具的复合实践，能够从主题和受众需求出发组织脚本、画面和声音。',
 '作品集包含产品概念短片、动画叙事、系列海报、生成式歌曲及真实城市影像；品牌题材作品是自主概念创作，能够提供完整作品而不只列工具名称。',
 '基于日常 After Effects 使用经验，在《只写代码》中负责创意和脚本，借助 Agent 生成 JavaScript 动效并渲染成片，约 1 小时完成多物体、不同动画与转场的 AE 风格表达。',
 '熟练使用 Premiere Pro、After Effects 和剪映，同时实践 Pavo AI、Midjourney、Suno、Fish Audio 及 Seedance、Veo、MiniMax 等内容工具与模型，能结合目标画面选择工作方式。',
 '具备素材规模化管理经验，并独立开发素材获取、音频分离、补帧与人机共用剪辑工具，将对创作流程的理解转化为可使用的效率软件。'
 ]},
 ops:{name:'AI 运营｜产品运营｜SEO / GEO',dirs:['aiOperation','aiProduct'],positions:['AI 产品运营','数字化运营','内容运营','品牌运营','SEO / GEO 运营'],ids:['trendscope','website','ztt-geo','growth','enterprise','afa',...brand,'portfolio-assistant','tcode','workflowhub','ai-project-commander',...creative.filter(id=>id.startsWith('visual-')),'aigc-luckin-coconut-latte','heytea-aigc-posters'],skills:['product','marketing','geo','data','ai','code','visual','aigc'],intro:[
 '我是重庆交通大学广告学 2027 届本科生，希望从事 AI 产品或数字化运营，优势是既理解内容与传播，又能把业务流程、用户反馈和规则沉淀为可落地的软件能力。',
 '在企业素材业务中协同达人运营、媒介及素材管理人员对齐 Brief、标签和交付标准，维护需求清单，按人工成本、频率与反馈确定优先级，并推动工具在小组实际使用。',
 '独立开发 TrendScope，将多来源热点整理为可回溯的趋势与选题依据；通过实际热点发现和人工核实完成内容案例，个人原创视频最高近 50 万播放。',
 '独立建设个人网站及 SEO / GEO，配置域名并优化抓取与索引；本人姓名检索测试中 Google 出现网站首位结果，ChatGPT 可在未提供域名时检索并引用个人网站。',
 '具有广告策划、账号运营、数据处理和内容生产经验，能够兼顾需求、渠道表达、指标口径与迭代，不把提案的计划目标包装成实际增长。'
 ]}
};
const selectedIds=curateProjects(catalog,sources);
for(const [track,ids] of Object.entries(selectedIds))tracks[track].ids=ids;
tracks.app.intro[3]='个人项目重点包括 Tcode 与本机工具编排、人机共用剪辑台、跨机器上下文交接及网申助手；关注接口契约、执行回执、部署使用和反馈迭代。';
function blocks(points){return {short:num(points.slice(0,1)),medium:num(points.slice(0,3)),long:num(points)};}
const profiles={};
for(const [t,c]of Object.entries(tracks)){
 const advantages=t==='app'?['业务拆解与选择能力：从最耗时、最可行的环节切入，结合投入产出规划开发，而不是为了使用模型而使用模型。','落地与质量意识：把规则、工具与模型分层，建立回执、结果检查及人工兜底，重视能否稳定交给同事使用。','复合背景：既能理解素材与运营业务，也能独立主导 Agent 辅助软件构建和上线。']:t==='aigc'?['创意与后期判断：传统 AE 与剪辑经验帮助判断画面、转场和音画关系，而非只依赖生成结果。','内容与工具双能力：既有可展示的成片、海报和策划，也能围绕真实制作难点自研素材及剪辑工具。','表达与系列化：结合广告学背景组织主题、文案、主视觉和传播路径，能够在系列内容中保持一致的阅读逻辑。']:['业务与产品视角：从一线流程发现需求，围绕频率、人工成本及用户反馈设定优先级。','数据与内容闭环：能将热点信号、人工核实、受众切入与发布反馈连接为运营实践。','AI 实施能力：不只提出运营建议，也能借助 Agent 将信息处理、内容辅助及自动化功能落地。'];
 const profile={basic:{...basic},education:structuredClone(education),sensitive:{...sensitive},internships:internshipFacts.map(x=>toExperience(x,t)),campus:campusFacts.map(x=>toExperience(x,t,true)),projects:[...new Set(c.ids)].map(id=>{const p=catalog.find(p=>p.id===id);if(!p)throw Error(`Missing ${id}`);return normalize(p,t);}),skills:{technical:c.skills.map(k=>skillBase[k]),tools:t==='aigc'?['Premiere Pro、After Effects、剪映、Lightroom','Pavo AI、Midjourney、Suno、Fish Audio','Seedance、Veo、MiniMax、Nano Banana、GPT Image','Claude Code、Codex、Cursor 等 Agent 工具']:['Claude Code、Codex、Cursor 等 Agent 工具','Playwright、影刀 RPA、Excel、飞书多维表格','Git / GitHub；Electron、React、Node.js、Python、FFmpeg 在独立项目中的应用实践（不等同全部熟练掌握）','ChatGPT、Gemini 及 AIGC 创作工具'],languages:['英语：大学英语六级 CET-6，成绩 455；可阅读和检索英文行业资料、AI 工具文档及基础技术资料。'],certificates:['大学英语六级（CET-6）'],awards:[]},jobPreferences:{expectedCity:['重庆','成都','杭州','深圳','广州','上海'],expectedPosition:c.positions,expectedSalary:'约 10000 元/月',availableDate:'',employmentType:'全职（2027 届校招）',expectedIndustry:'AI／互联网／科技／SaaS／数字营销；兼顾汽车、新能源与智能制造企业'},careerPreferences:{targetDirections:c.positions,preferredWorkTypes:['围绕真实业务问题的产品与工具落地','需求、实施和反馈可形成闭环的工作'],developmentGoals:['持续加强技术基础与项目验收能力','在实际业务中积累可验证的产品和运营成果']},content:{selfIntroduction:blocks(c.intro),selfEvaluation:blocks([...advantages,'能够承认验证边界，遇到规则冲突、低置信度或不可复现问题时保留证据并引入人工处理，不以模糊结论冒充已完成。']),personalAdvantages:blocks(advantages),careerPlan:blocks([`希望从事${c.positions.slice(0,3).join('、')}相关岗位，将现有项目经验用于实际团队任务。`,'入职初期优先熟悉用户、业务指标与现有流程，明确约束和验收条件；从高频、高成本且可行的需求切入。','持续加强 Python 与接口基础、工具质量及反馈分析，逐步独立负责更完整的需求落地与迭代。']),hobbies:blocks(['长期关注摄影、视频剪辑、AI 应用与内容创作，习惯将日常重复需求做成个人工具。','关注动漫、游戏及互联网话题，结合受众兴趣进行内容观察和选题实践。','有原神、鸣潮、明日方舟、赛博朋克 2077 等游戏体验；用于游戏相关岗位时可进一步展开用户体验观察，不将娱乐时长直接当成专业工作经历。'])}};
 const v=validateProfile(profile);if(!v.ok)throw Error(JSON.stringify(v.errors));profiles[t]=v.profile;
 fs.writeFileSync(path.join(here,`${t}_岗位资料.json`),JSON.stringify({kind:'application-form-assistant/profile',version:1,profile:v.profile},null,2),'utf8');
 const md=[`# ${c.name}资料库`,`项目 ${profile.projects.length} 条；实习 3 条；校园经历 2 条。`,`## 自我介绍`,profile.content.selfIntroduction.long,`## 实习经历`,...profile.internships.flatMap(x=>[`### ${x.company}｜${x.position}`,`${x.startDate} - ${x.endDate}`,x.descriptionLong]),`## 项目资料`,...profile.projects.flatMap(x=>[`### ${x.name}`,`${x.startDate||'起点待确认'} - ${x.endDate||'终点待确认'}｜${x.role}`,x.background,x.descriptionLong]),`## 专业技能`,num(profile.skills.technical),`## 个人优势`,profile.content.personalAdvantages.long];
 fs.writeFileSync(path.join(here,`${t}_资料库内容预览.md`),md.join('\n\n'),'utf8');
}
const pack={kind:'ztt/application-form-assistant/role-library-pack',version:1,generatedAt:new Date().toISOString(),libraries:Object.entries(profiles).map(([t,profile])=>({id:`ztt_${t}_20261006`,name:tracks[t].name,directions:tracks[t].dirs,note:'按岗位含金量精选完整项目；视频、海报和小工具归为案例／组件，保留完整职责与成果。',profile})),sourceAudit:sources};
fs.writeFileSync(path.join(here,'三岗位资料库导入包.json'),JSON.stringify(pack,null,2),'utf8');
fs.writeFileSync(path.join(here,'证据与待确认事项.md'),['# 来源与填写边界','1. 主要读取网站 src/data，包括 productProjects、projectCases、motionProjects、visualProjects、musicProjects；同时核对现有三份简历、项目 README 和个人主档案。','2. 年龄、电话、邮箱、GPA 和排名等来自本人资料；生日、微信、政治面貌、详细地址、紧急联系人等未提供，保持空白。排名 31 没有分母，不转换为百分比。','3. 少数项目只有年度证据，保留 2026 年度精度；创作子作品和独立提案未确认具体起止月，保持空白，不按上传日或文件迁移时间猜测。综合创作实践可保留 2024.09 - 2026.10。','4. 95%+ 尚无明确抽检分母与样本期，继续使用可解释的 70% → 90%+ 抽检口径；不以长期没报错冒充全量准确率。','5. 企业后端与 ZTT Code 为同一生产方案的工具端和 Agent 端，结果不重复计数。新工具、探索项目和品牌提案不冒充企业稳定运行或付费委托。','6. 日期采用本人当前校招资料中的 2026.07 - 2026.10 等区间；到岗时间、出差、加班、异地等偏好未确认，不代填承诺。','## 项目来源',...sources.map(s=>`- ${s.name}：${s.sources.join('；')}。${s.notes}`)].join('\n\n'),'utf8');
console.log(JSON.stringify({catalog:catalog.length,libraries:pack.libraries.map(l=>({name:l.name,projects:l.profile.projects.length,internships:l.profile.internships.length,campus:l.profile.campus.length,chars:JSON.stringify(l.profile).length})),output:here},null,2));
