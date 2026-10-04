import { CANONICAL_FIELDS } from "./canonicalFields";

/**
 * 字段别名词表。
 * 匹配前双方都会经过 normalizeText()，所以这里直接写 normalize 后的形式：
 * 小写、无多余空格、无冒号/星号/括号、无「必填/选填」。
 *
 * 覆盖面：主流国内 ATS（北森、Moka、大易、智联、牛客、姚记类自研系统）与
 * 英文 Workday/Greenhouse 类表单的高频标签。宁可多列同义词，也不留 UNKNOWN。
 */
export const FIELD_ALIASES: Record<string, string[]> = {
  "basic.name": [
    "姓名", "名字", "你的姓名", "学生姓名", "真实姓名", "应聘者姓名", "申请人姓名", "考生姓名",
    "员工姓名", "联系人姓名", "尊姓大名",
    "name", "full name", "fullname", "your name", "candidate name", "student name",
    "applicant name", "employee name",
  ],
  "basic.englishName": [
    "英文名", "英文姓名", "英文名称", "英文",
    "english name", "name in english", "english",
  ],
  /**
   * 姓名拆分：英文 ATS（Greenhouse / Lever / Workday / Workable）一律 First name + Last name。
   * 只写「first name」这类完整词组，不写「name」这种被无数标签包含的词。
   */
  "basic.surname": [
    "姓氏", "您的姓氏", "家族姓氏",
    "last name", "lastname", "family name", "surname", "sur name",
  ],
  "basic.givenName": [
    "名字（不含姓）", "单名", "名（不含姓氏）",
    "first name", "firstname", "given name", "givenname", "forename", "first name (given name)",
  ],
  "basic.linkedin": [
    "领英", "领英主页", "领英链接", "领英个人资料",
    "linkedin", "linkedin profile", "linkedin url", "linked in", "lnkd",
  ],
  "basic.github": [
    "github", "github url", "github profile", "github 主页", "github 链接",
    "代码仓库", "开源仓库", "开源主页", "个人仓库",
  ],
  "basic.gender": [
    "性别", "男女", "您的性别", "性别（男/女）",
    "gender", "sex",
  ],
  "basic.birthDate": [
    "出生日期", "出生年月", "出生年月日", "生日", "出生",
    "date of birth", "birth date", "birthday", "dob", "born date", "birth",
  ],
  "basic.phone": [
    "手机号", "手机号码", "手机", "移动电话", "联系电话", "联系电话号码", "联络电话",
    "电话", "电话号码", "联系方式", "本人手机", "手机", "手机电话",
    "mobile", "mobile phone", "phone", "phone number", "telephone", "tel", "cellphone",
    "cell phone", "contact number", "contact", "phone no", "tel no",
  ],
  "basic.email": [
    "邮箱", "电子邮箱", "邮箱地址", "电子邮件", "电子邮件地址", "常用邮箱", "联系邮箱", "邮箱账号", "邮件地址",
    "email", "email address", "e-mail", "e-mail address", "mail", "email account",
  ],
  "basic.wechat": [
    "微信", "微信号", "微信号码", "微信账号",
    "wechat", "weixin", "wechat id", "wechat no", "weixin id",
  ],
  "basic.qq": [
    "qq号", "qq号码", "qq账号", "扣扣号", "oicq",
    "qq number", "tencent qq",
  ],
  "basic.age": [
    "年龄", "岁数", "周岁", "您的年龄",
    "age", "years old",
  ],
  "basic.portfolio": [
    "个人主页", "个人网站", "作品集", "作品集链接", "主页链接", "网站链接", "个人博客", "博客地址",
    "portfolio", "personal website", "website", "homepage", "blog", "website link",
  ],
  "basic.city": [
    "所在城市", "居住城市", "现居城市", "现居地", "所在地区", "城市", "所在地",
    "常驻城市", "居住地", "现居住地", "当前城市", "所在省市",
    "current location", "current city", "city", "where are you based", "based in", "location of residence",
    "city", "location", "current city", "living city", "base city", "resident city",
  ],
  "basic.address": [
    "通讯地址", "联系地址", "邮寄地址", "住址", "居住地址", "家庭住址", "现居住地址", "详细地址", "地址",
    "address", "home address", "mailing address", "current address", "permanent address",
  ],
  "basic.idNumber": [
    "身份证号", "身份证号码", "证件号码", "证件号", "身份证", "居民身份证号码", "身份号码",
    "id number", "id card number", "identity number", "national id", "id no",
  ],
  "basic.nativePlace": [
    "籍贯", "原籍", "祖籍", "户籍籍贯",
    "native place", "place of origin", "hometown",
  ],
  "basic.hukou": [
    "户口所在地", "户籍所在地", "户口", "户籍", "户口地址", "户籍地址", "生源所在地", "生源地",
    "hukou", "household registration", "place of household registration",
  ],
  "basic.hukouType": [
    "户口性质", "户籍性质", "户籍类型", "户口类型",
    "hukou type", "household registration type",
  ],
  "basic.politicalStatus": [
    "政治面貌", "政治状态", "面貌", "党派", "政治身份", "是否党员",
    "political status", "political affiliation",
  ],
  "basic.maritalStatus": [
    "婚姻状况", "婚姻情况", "婚否", "婚姻", " marital status", "marital status", "married", "婚姻状态",
  ],
  "basic.height": ["身高", "净身高", "height", " stature"],
  "basic.weight": ["体重", "weight"],
  "basic.workYears": [
    "工作年限", "从业年限", "工作经验年限", "总工作年限", "工作年数",
    "years of experience", "work experience years", "total experience",
  ],
  "basic.emergencyContactName": [
    "紧急联系人", "紧急联系人姓名", "联系人姓名", "紧急联络人",
    "emergency contact", "emergency contact name",
  ],
  "basic.emergencyContactPhone": [
    "紧急联系电话", "紧急联系人电话", "紧急联系人手机号", "紧急联系方式",
    "emergency contact number", "emergency phone",
  ],

  "education.school": [
    "学校", "学校名称", "院校", "院校名称", "毕业院校", "就读院校", "本科院校", "毕业学校", "大学",
    "就读学校", "毕业高校", "高校名称", "学校/院校",
    "school", "school name", "university", "university name", "college name", "institution",
  ],
  "education.college": [
    "学院", "院系", "二级学院", "院系名称", "系", "所系", "所属院系", "系别",
    "college", "faculty", "department", "school of",
  ],
  "education.major": [
    "专业", "所学专业", "本科专业", "专业名称", "主修专业", "主修", "修读专业", "学习专业",
    "major", "major name", "field of study", "field", "study field",
  ],
  "education.degree": [
    "学历", "最高学历", "学历层次", "在读学历", "取得学历", "最终学历", "文化程度", "教育程度", "现有学历",
    "education level", "highest education", "highest education level", "qualification",
  ],
  "education.degreeType": [
    "学位", "获得学位", "学位名称", "学位类型", "授予学位",
    "degree", "academic degree", "degree obtained", "type of degree",
  ],
  "education.direction": [
    "研究方向", "专业方向", "所在研究方向", "课题方向", "专业细分方向",
    "research direction", "specialization", "concentration", "field of research",
  ],
  "education.educationLevel": [
    "学习形式", "教育形式", "培养方式", "就读形式", "全日制", "非全日制", "education mode", "study mode",
  ],
  "education.startDate": [
    "入学时间", "入学年份", "入学日期", "就读时间", "入学年月", "在读开始时间",
    "start date", "enrollment date", "education start",
  ],
  "education.endDate": [
    "毕业时间", "毕业日期", "毕业年份", "毕业年月", "预计毕业时间", "预计毕业年月", "预计毕业",
    "end date", "graduation date", "expected graduation", "education end",
  ],
  "education.gpa": ["gpa", "g.p.a", "绩点", "平均绩点", "成绩绩点", "gpa成绩"],
  "education.rank": [
    "专业排名", "年级排名", "排名", "名次",
    "rank", "class rank", "ranking",
  ],

  /**
   * 「是否有实习经历」是非题。别名一律写成**完整问句**：
   * 「实习经历」这种裸名词会是textarea「请描述你的实习经历」的标签，
   * 命中后会把「是」塞进描述框 —— 那是错填，不是少填。
   */
  "internship.hasExperience": [
    "是否有实习经历", "是否有实习经验", "是否有过实习经历", "是否有过实习", "是否有相关实习经历",
    "是否有实习", "是否参加过实习", "有无实习经历", "是否有工作经历", "是否有工作经验",
    "是否有相关工作经验", "是否具备相关工作经验", "do you have internship experience", "have you completed an internship",
  ],
  "internship.company": [
    "实习公司", "实习单位", "实习企业", "公司名称", "公司", "单位名称", "工作单位",
    "实习公司名称", "实习单位名称", "就职单位", "就职公司", "用人单位", "工作单位名称", "实习机构",
    "company", "company name", "employer", "organization", "organisation", "company/organization",
  ],
  "internship.department": [
    "部门", "所在部门", "部门名称", "任职部门", "实习部门", "工作部门", "所属部门",
    "department", "dept", "department name",
  ],
  "internship.position": [
    "实习岗位", "实习职位", "岗位名称", "职位名称", "职位", "岗位", "担任职位",
    "实习职务", "工作岗位", "担任职务", "从事岗位", "工作职位", "职务", "实习岗位名称",
    "position", "internship position", "job title", "title", "role", "post",
  ],
  "internship.startDate": [
    "实习开始时间", "开始时间", "任职时间", "入职时间", "起始时间", "实习起始时间", "开始日期",
    "start date", "internship start", "employment start",
  ],
  "internship.endDate": [
    "实习结束时间", "结束时间", "离职时间", "截止时间", "实习截止时间", "结束日期",
    "end date", "internship end", "employment end",
  ],
  // 语义拆分：职责/内容/业绩/总结各有独立词表，表单问什么就填什么，
  // 不再全挤进 description 按长度取。description 仅作「经历描述」类兜底。
  "internship.description": [
    "实习描述", "实习内容", "实习经历描述", "实习介绍",
    "工作描述", "经历描述", "工作经历描述", "实践内容", "实践描述",
    "internship description", "work description", "job description",
    "internship experience", "experience description",
  ],
  "internship.responsibilities": [
    "工作职责", "岗位职责", "职责描述", "主要职责", "职责", "岗位职责描述", "负责工作", "负责内容",
    // 字节跳动官网真机文案：不补这条，「职位描述」会被裸别名「职位」抢去当岗位名
    "职位描述", "职务描述",
    "responsibilities", "job responsibilities", "key responsibilities", "main responsibilities",
    "job duties", "duties",
  ],
  "internship.workContent": [
    "工作内容", "主要工作内容", "工作内容描述", "主要工作", "工作详情", "实习工作内容", "具体工作内容",
    "work content", "what you did", "main tasks",
  ],
  "internship.achievements": [
    "工作业绩", "主要业绩", "业绩", "工作成果", "成果", "工作亮点", "业绩描述", "工作产出",
    "achievements", "work achievements", "work highlights", "key achievements",
  ],
  "internship.summary": [
    "实习总结", "实习收获", "工作收获", "实习心得", "心得体会", "收获与体会", "总结与收获",
    "internship summary", "internship reflection",
  ],
  "campus.organization": [
    "组织", "社团", "社团名称", "学生会", "学生组织", "协会名称", "社团/学生会", "学生社团",
    "organization", "club", "society", "student club",
  ],
  "campus.department": [
    "社团部门", "学生会部门", "校园部门", "所在社团部门",
    "club department",
  ],
  "campus.position": [
    "社团职务", "学生工作职务", "校内职务", "在校职务", "在校职务名称", "职务", "学生干部职务", "担任学生工作",
    "student position", "club role",
  ],
  "campus.startDate": [
    "在校开始时间", "加入时间", "加入日期", "入会时间",
    "join date", "campus start",
  ],
  "campus.endDate": [
    "在校结束时间", "离任时间", "退会时间",
    "campus end",
  ],
  "campus.description": [
    "校园经历描述", "社团活动描述", "校园实践描述", "实践经历",
    "课外活动", "校园活动", "活动描述", "校园经历", "社团经历", "学生工作经历",
    "campus experience description", "activity description", "student activities",
    "extracurricular activities", "club activities",
  ],
  "campus.responsibilities": [
    "学生工作职责", "校内工作职责", "社团工作职责",
    "student responsibilities",
  ],
  "campus.workContent": [
    "学生工作内容", "社团工作内容", "校园工作内容",
    "student work content",
  ],
  "campus.achievements": [
    "活动成果", "活动亮点", "校园工作成果",
    "activity achievements",
  ],
  "campus.summary": [
    "活动总结", "活动收获", "实践总结", "校园经历总结", "社团活动总结",
    "campus summary",
  ],

  /** 「是否有项目经验」是非题（同上：只写完整问句，英文问句会和 `project` 这个宽别名打架，故不写） */
  "project.hasExperience": [
    "是否有项目经验", "是否有过项目经验", "是否有项目经历", "有无项目经验",
    "是否参与过项目", "是否有过参与项目", "是否有项目管理经验",
  ],
  "project.name": [
    "项目名称", "项目", "项目名", "项目/课题名称", "课题名称", "项目题目",
    "project name", "project", "project title",
  ],
  "project.role": [
    "项目角色", "担任角色", "你的角色", "角色", "项目中角色", "承担角色", "项目职务", "项目职位", "项目中的职务", "职务",
    "project role", "your role", "position in project",
  ],
  "project.startDate": [
    "项目开始时间", "项目起始时间", "项目开始日期",
    "start date", "project start",
  ],
  "project.endDate": [
    "项目结束时间", "项目截止时间", "项目结束日期",
    "end date", "project end",
  ],
  "project.description": [
    "项目描述", "项目介绍", "项目简介", "项目详情", "项目经历描述",
    "project description", "project detail", "project experience", "description",
  ],
  "project.background": [
    "项目背景", "项目背景介绍", "背景介绍",
    "background", "project background",
  ],
  "project.responsibilities": [
    "项目职责", "项目中职责", "项目工作职责", "项目分工",
    "project responsibilities",
  ],
  "project.workContent": [
    "项目内容", "项目工作内容", "项目核心内容", "项目主要工作", "核心功能",
    "project content", "project features",
  ],
  "project.achievements": [
    "项目成果", "项目业绩", "项目亮点", "项目收获", "成果描述",
    "project achievements", "project highlights",
  ],
  "project.summary": [
    "项目概述", "项目总结",
    "project summary",
  ],

  "skills.technical": [
    "技能", "技术技能", "专业技能", "it技能", "掌握技能", "核心技能", "专长",
    "技能特长", "掌握的技能", "擅长技能", "技术栈", "专长领域",
    "skills", "technical skills", "key skills", "core skills", "tech stack", "proficient in",
  ],
  "skills.tools": [
    "工具", "常用工具", "工具技能", "软件工具", "常用软件", "办公软件", "软件技能", "熟练工具",
    "tools", "software", "toolkit", "familiar tools", "software skills",
  ],
  "skills.languages": [
    "语言能力", "语言", "外语水平", "英语水平", "语言技能", "普通话", "外语语种", "外语能力",
    "languages", "language skills", "language",
  ],
  "skills.certificates": [
    "证书", "证书名称", "资格证书", "获得证书", "持证情况", "认证", "资质", "职业资格", "证书等级",
    "英语等级", "外语等级", "等级证书", "计算机等级", "计算机等级证书", "语言等级", "雅思成绩", "托福成绩",
    "certificates", "certifications", "certificate", "credentials", "qualification certificate",
    "english level", "toefl", "ielts",
  ],
  "skills.awards": [
    "获奖", "获奖情况", "获奖经历", "获奖奖项", "荣誉", "所获荣誉", "荣誉奖项", "奖项", "获奖证书",
    "awards", "honors", "prizes", "awards & honors",
  ],

  "job.expectedCity": [
    "期望城市", "意向城市", "期望工作城市", "期望工作地点", "工作城市", "意向工作地",
    "意向工作城市", "期望工作地区", "可工作城市", "可工作地点", "工作地点", "意向地点", "期望地点",
    "expected city", "preferred city", "desired city", "work city", "preferred location",
    "location preference", "work location preference",
  ],
  "job.expectedPosition": [
    "期望岗位", "意向岗位", "期望职位", "意向职位", "求职意向", "期望工作",
    "应聘岗位", "应聘职位", "申请岗位", "申请职位", "求职岗位", "岗位意向", "意向方向", "期望岗位名称",
    "expected position", "desired position", "preferred position", "preferred role",
    "position preference", "target position", "applied position", "position applied for",
    "desired role",
  ],
  "job.expectedSalary": [
    "期望薪资", "期望工资", "期望薪酬", "薪资期望", "薪资要求", "期望月薪", "期望年薪",
    "薪资范围", "期望薪资范围", "薪酬范围", "薪资待遇",
    "expected salary", "desired salary", "salary expectation", "salary expectations",
    "expected pay", "salary range",
  ],
  "job.availableDate": [
    "到岗时间", "可到岗时间", "最早到岗时间", "可入职时间", "到岗日期", "预计到岗时间", "可开始时间",
    "available date", "availability", "start availability", "earliest start date",
  ],
  "job.employmentType": [
    "就业类型", "工作性质", "用工类型", "雇佣类型", "工作类型", "实习/全职",
    "实习类型", "岗位性质", "职位性质", "用工性质",
    "employment type", "job type", "work type", "position type", "job nature", "internship type",
  ],
  "job.expectedIndustry": [
    "期望行业", "意向行业", "目标行业", "期望行业领域", "行业意向",
    "expected industry", "preferred industry", "desired industry", "target industry",
  ],
  /**
   * 「是否…」偏好单选题。别名一律写成**问句形态**（含「是否/能否/可否/接受」），
   * 不写「加班」「异地」这种单词——否则「对加班的看法」这类文本框会被误判成单选题。
   */
  "job.acceptOfflineInterview": [
    "是否接受线下面试", "是否接受线下", "是否能接受线下面试", "可否接受线下面试", "是否同意线下面试",
    "接受线下面试", "可以接受线下面试", "线下面试", "线下到面", "是否可到线下", "是否参加线下面试",
    "on-site interview", "in person interview", "offline interview", "onsite interview",
  ],
  "job.acceptOnlineInterview": [
    "是否接受线上面试", "是否能接受线上面试", "可否接受线上面试", "是否同意线上面试",
    "接受线上面试", "可以接受线上面试", "线上面试", "视频面试", "是否接受视频面试", "远程面试",
    "online interview", "remote interview", "video interview",
  ],
  "job.acceptBusinessTrip": [
    "是否接受出差", "能否接受出差", "可否接受出差", "是否同意出差", "接受出差", "可以出差", "出差接受度",
    "willing to travel", "travel required", "business trip",
  ],
  "job.acceptRelocation": [
    "是否接受异地", "是否接受异地工作", "能否接受异地", "是否接受外派", "能否接受外派", "接受异地工作",
    "可接受异地", "是否愿意改变工作地点", "异地工作",
    "willing to relocate", "relocation preference", "willingness to relocate",
  ],
  "job.acceptOvertime": [
    "是否接受加班", "能否接受加班", "可否接受加班", "是否同意加班", "可以接受加班", "接受加班吗", "加班接受度",
    "willing to work overtime", "overtime preference",
  ],

  "content.selfIntroduction": [
    "自我介绍", "自我简介", "介绍一下你自己", "个人介绍", "个人简介", "自我推荐", "介绍一下自己",
    "self introduction", "introduce yourself", "about me", "about yourself",
    "personal introduction", "brief introduction",
  ],
  "content.selfEvaluation": [
    "自我评价", "自我评价（简短）", "自我总结", "个人评价", "综合自我评价",
    "self evaluation", "self-assessment", "self assessment", "self summary", "personal evaluation",
  ],
  "content.personalAdvantages": [
    "个人优势", "你的优势", "个人优点", "个人亮点", "自身优势", "优势", "核心竞争力", "个人特长",
    "personal advantages", "your strengths", "strengths", "advantages", "key strengths",
    "competitive advantages",
  ],
  "content.careerPlan": [
    "职业规划", "职业规划（简短）", "你的职业规划", "职业目标", "未来规划", "职业发展规划",
    "职业目标规划", "发展计划", "职业生涯规划",
    "career plan", "career planning", "career goal", "career goals", "future plan",
    "career aspiration", "career objectives", "future career plan",
  ],
  "content.hobbies": [
    "兴趣爱好", "兴趣", "爱好", "特长爱好", "业余爱好", "你的兴趣爱好",
    "hobbies", "interests", "hobbies & interests",
  ],
};

// 自检：别名表的 key 必须全部是 canonical field id，防止拼写漂移
for (const key of Object.keys(FIELD_ALIASES)) {
  if (!CANONICAL_FIELDS.some((f) => f.id === key)) {
    throw new Error(`FIELD_ALIASES 含未知 canonical id: ${key}`);
  }
}
