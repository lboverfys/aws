/**
 * 工具函数：密码生成、姓名生成等
 */

// 常见英文名（包含昵称变体和国际化名字）
const FIRST_NAMES = [
  // 英文男性名
  "James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph",
  "Thomas", "Charles", "Christopher", "Daniel", "Matthew", "Anthony", "Mark",
  "Donald", "Steven", "Paul", "Andrew", "Joshua", "Kenneth", "Kevin", "Brian",
  "George", "Timothy", "Ronald", "Edward", "Jason", "Jeffrey", "Ryan",
  "Jacob", "Nicholas", "Tyler", "Brandon", "Christian", "Benjamin", "Nathan",
  "Samuel", "Dylan", "Ethan", "Noah", "Alexander", "Logan", "Caleb", "Lucas",
  "Mason", "Jayden", "Aiden", "Jack", "Luke", "Jordan", "Gavin", "Connor",
  "Evan", "Owen", "Cole", "Isaac", "Henry", "Sebastian", "Zachary", "Adrian",
  "Aaron", "Adam", "Austin", "Blake", "Cameron", "Carter", "Chase", "Cody",
  "Derek", "Dustin", "Eric", "Gabriel", "Grant", "Hunter", "Ian", "Ivan",
  "Jesse", "Justin", "Kyle", "Landon", "Marcus", "Max", "Oscar", "Patrick",
  "Peter", "Philip", "Raymond", "Sean", "Shane", "Spencer", "Travis", "Trevor",
  "Victor", "Vincent", "Wesley", "Xavier", "Zachary",
  // 英文男性昵称
  "Mike", "Chris", "Matt", "Dan", "Dave", "Bob", "Rob", "Tom", "Tony", "Joe",
  "Steve", "Andy", "Ben", "Nick", "Jake", "Alex", "Sam", "Josh", "Tim", "Jim",
  "Bill", "Ted", "Rick", "Greg", "Jeff", "Scott", "Brad", "Chad", "Craig",
  // 英文女性名
  "Mary", "Patricia", "Jennifer", "Linda", "Barbara", "Elizabeth", "Susan",
  "Jessica", "Sarah", "Karen", "Lisa", "Nancy", "Betty", "Margaret", "Sandra",
  "Ashley", "Kimberly", "Emily", "Donna", "Michelle", "Dorothy", "Carol",
  "Amanda", "Melissa", "Deborah", "Stephanie", "Rebecca", "Sharon", "Laura",
  "Cynthia", "Kathleen", "Amy", "Angela", "Shirley", "Anna", "Brenda", "Pamela",
  "Emma", "Nicole", "Helen", "Samantha", "Katherine", "Christine", "Debra",
  "Rachel", "Carolyn", "Janet", "Catherine", "Maria", "Heather", "Diane",
  "Ruth", "Julie", "Olivia", "Joyce", "Virginia", "Victoria", "Kelly", "Lauren",
  "Christina", "Joan", "Evelyn", "Judith", "Megan", "Andrea", "Cheryl", "Hannah",
  "Jacqueline", "Martha", "Gloria", "Teresa", "Ann", "Sara", "Madison", "Frances",
  "Kathryn", "Janice", "Jean", "Abigail", "Alice", "Judy", "Sophia", "Grace",
  "Denise", "Amber", "Doris", "Marilyn", "Danielle", "Beverly", "Isabella",
  "Theresa", "Diana", "Natalie", "Brittany", "Charlotte", "Marie", "Kayla", "Alexis",
  // 英文女性昵称
  "Kate", "Katie", "Jenny", "Jess", "Liz", "Beth", "Meg", "Mandy", "Becky", "Vicky",
  "Tina", "Kim", "Sue", "Anne", "Jen", "Steph", "Sam", "Alex", "Chris", "Nicky",
  // 西班牙语名
  "Carlos", "Miguel", "Luis", "Jorge", "Jose", "Juan", "Pedro", "Diego", "Fernando",
  "Ricardo", "Alberto", "Alejandro", "Rafael", "Manuel", "Francisco", "Antonio",
  "Sofia", "Isabella", "Valentina", "Camila", "Lucia", "Elena", "Paula", "Carmen",
  "Rosa", "Ana", "Gabriela", "Adriana", "Claudia", "Diana", "Laura", "Monica",
  // 德语/北欧名
  "Hans", "Klaus", "Stefan", "Wolfgang", "Dieter", "Andreas", "Markus", "Lars",
  "Erik", "Olaf", "Magnus", "Sven", "Axel", "Bjorn", "Henrik", "Ingrid", "Astrid",
  "Greta", "Helga", "Petra", "Sabine", "Monika", "Ursula", "Brigitte",
  // 法语名
  "Jean", "Pierre", "Jacques", "Philippe", "Michel", "Francois", "Louis", "Andre",
  "Marie", "Sophie", "Claire", "Anne", "Julie", "Camille", "Chloe", "Lea",
  // 意大利名
  "Marco", "Giovanni", "Giuseppe", "Paolo", "Luca", "Andrea", "Matteo", "Lorenzo",
  "Giulia", "Francesca", "Chiara", "Sara", "Valentina", "Alessia", "Martina",
];

// 常见英文姓（包含国际化姓氏）
const LAST_NAMES = [
  // 英语姓
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
  "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
  "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen",
  "Hill", "Flores", "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera",
  "Campbell", "Mitchell", "Carter", "Roberts", "Turner", "Phillips", "Parker",
  "Evans", "Edwards", "Collins", "Stewart", "Morris", "Murphy", "Cook", "Rogers",
  "Morgan", "Peterson", "Cooper", "Reed", "Bailey", "Bell", "Howard", "Ward",
  "Cox", "Richardson", "Wood", "Watson", "Brooks", "Bennett", "Gray", "James",
  "Hughes", "Price", "Sanders", "Ross", "Long", "Foster", "Powell", "Jenkins",
  "Perry", "Russell", "Sullivan", "Fisher", "Henderson", "Cole", "West", "Jordan",
  "Reynolds", "Hamilton", "Graham", "Wallace", "Woods", "Hayes", "Bryant", "Shaw",
  "Kennedy", "Burns", "Gordon", "Dixon", "Gibson", "Mason", "Boyd", "Hunt",
  "Warren", "Fox", "Rose", "Stone", "Burke", "Webb", "Hunter", "Dean", "Palmer",
  "Knight", "Freeman", "Wells", "Hart", "Ford", "May", "Black", "Lane", "Grant",
  // 西班牙语姓
  "Fernandez", "Gomez", "Diaz", "Morales", "Reyes", "Cruz", "Ortiz", "Gutierrez",
  "Chavez", "Ramos", "Vargas", "Castillo", "Jimenez", "Ruiz", "Mendoza", "Aguilar",
  "Moreno", "Medina", "Dominguez", "Castro", "Herrera", "Silva", "Vasquez",
  // 德语/北欧姓
  "Mueller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker",
  "Hoffmann", "Schulz", "Koch", "Richter", "Klein", "Wolf", "Schroeder", "Neumann",
  "Schwarz", "Braun", "Zimmermann", "Krueger", "Larsen", "Nielsen", "Jensen",
  "Andersen", "Olsen", "Hansen", "Johansson", "Eriksson", "Lindberg", "Berg",
  // 法语姓
  "Bernard", "Dubois", "Moreau", "Laurent", "Simon", "Michel", "Lefevre", "Leroy",
  "Roux", "David", "Bertrand", "Morel", "Fournier", "Girard", "Bonnet", "Dupont",
  // 意大利姓
  "Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci",
  "Marino", "Greco", "Bruno", "Gallo", "Conti", "Costa", "Giordano", "Mancini",
];

/**
 * 生成随机密码
 * 包含大小写字母、数字和特殊字符
 * @param {number} length - 密码长度，默认12
 * @returns {string} 生成的密码
 */
function generatePassword(length = 12) {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const special = '!@#$%^&*';

  // 确保至少包含每种类型的字符
  const password = [
    lowercase[Math.floor(Math.random() * lowercase.length)],
    uppercase[Math.floor(Math.random() * uppercase.length)],
    digits[Math.floor(Math.random() * digits.length)],
    special[Math.floor(Math.random() * special.length)]
  ];

  // 填充剩余长度
  const allChars = lowercase + uppercase + digits + special;
  for (let i = 4; i < length; i++) {
    password.push(allChars[Math.floor(Math.random() * allChars.length)]);
  }

  // 打乱顺序 (Fisher-Yates shuffle)
  for (let i = password.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [password[i], password[j]] = [password[j], password[i]];
  }

  return password.join('');
}

/**
 * 生成随机英文姓名
 * @returns {{firstName: string, lastName: string}} 姓名对象
 */
function generateName() {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return { firstName, lastName };
}

/**
 * 生成完整姓名字符串
 * @returns {string} 完整姓名
 */
function generateFullName() {
  const { firstName, lastName } = generateName();
  return `${firstName} ${lastName}`;
}

/**
 * 生成仿真邮箱前缀
 * 格式类似真实用户邮箱：firstname.lastname2024, johnsmith0115 等
 * @param {string} [firstName] - 名（可选，不提供则随机生成）
 * @param {string} [lastName] - 姓（可选，不提供则随机生成）
 * @returns {string} 邮箱前缀
 */
function generateEmailPrefix(firstName, lastName) {
  // 如果没有提供姓名，随机生成
  if (!firstName || !lastName) {
    const name = generateName();
    firstName = name.firstName;
    lastName = name.lastName;
  }

  const first = firstName.toLowerCase();
  const last = lastName.toLowerCase();

  // 随机年份（无时间关联）
  const birthYear = 1970 + Math.floor(Math.random() * 34); // 1970-2003
  const oldYear = 2015 + Math.floor(Math.random() * 9);    // 2015-2023
  const shortBirth = String(birthYear).slice(-2);
  const shortOld = String(oldYear).slice(-2);

  // 随机数字后缀
  const randomNum = Math.floor(Math.random() * 100);
  const randomNum3 = Math.floor(Math.random() * 1000);
  const randomMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const randomDay = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');

  // 多种常见邮箱格式（无当前日期关联）
  const patterns = [
    // firstname.lastname 系列
    `${first}.${last}${shortOld}`,            // john.smith19
    `${first}.${last}${oldYear}`,             // john.smith2019
    `${first}.${last}${randomMonth}${randomDay}`, // john.smith0315

    // firstnamelastname 系列
    `${first}${last}${shortBirth}`,           // johnsmith85
    `${first}${last}${oldYear}`,              // johnsmith2019
    `${first}${last}${randomNum}`,            // johnsmith42

    // firstname_lastname 系列
    `${first}_${last}${shortOld}`,            // john_smith19
    `${first}_${last}${birthYear}`,           // john_smith1985

    // first initial + lastname 系列
    `${first[0]}${last}${oldYear}`,           // jsmith2019
    `${first[0]}${last}${randomNum3}`,        // jsmith123
    `${first[0]}.${last}${shortBirth}`,       // j.smith85

    // firstname + last initial 系列
    `${first}${last[0]}${oldYear}`,           // johns2019
    `${first}.${last[0]}${shortOld}`,         // john.s19

    // 纯名字 + 数字
    `${first}${randomNum3}`,                  // john123
    `${first}${birthYear}`,                   // john1985
    `${last}${first}${shortOld}`,             // smithjohn19

    // 无数字模式
    `${first}.${last}`,                       // john.smith
    `${first}_${last}`,                       // john_smith
    `${first}${last}`,                        // johnsmith
    `${last}.${first}`,                       // smith.john
  ];

  // 随机选择一种格式
  return patterns[Math.floor(Math.random() * patterns.length)];
}

/**
 * 生成 UUID
 * @returns {string} UUID 字符串
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * 延迟函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 导出函数（用于 ES modules）
export {
  generatePassword,
  generateName,
  generateFullName,
  generateEmailPrefix,
  generateUUID,
  sleep,
  FIRST_NAMES,
  LAST_NAMES
};
