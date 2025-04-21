const axios = require('axios');
const fs = require('fs/promises');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { Keypair } = require('@solana/web3.js');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

const emojis = {
  success: '✅',
  error: '❌',
  pending: '⏳',
  info: 'ℹ️',
  money: '💰',
  rocket: '🚀',
  star: '⭐',
  time: '⏱️',
  check: '✓',
  warning: '⚠️',
  key: '🔑',
  network: '🌐',
  change: '🔄',
  wallet: '💳'
};

// Proxy format regex patterns
const PROXY_FORMATS_REGEXP = [
  /^(?:(?<protocol>.+):\/\/)?(?<login>[^@:]+):(?<password>[^@]+)[@](?<host>[^@:\s]+):(?<port>\d{1,5})(?:\[(?<refresh_url>https?:\/\/[^\s\]]+)\])?$/,
  /^(?:(?<protocol>.+):\/\/)?(?<host>[^@:\s]+):(?<port>\d{1,5})[@](?<login>[^@:]+):(?<password>[^@]+)(?:\[(?<refresh_url>https?:\/\/[^\s\]]+)\])?$/,
  /^(?:(?<protocol>.+):\/\/)?(?<host>[^@:\s]+):(?<port>\d{1,5})(?:\[(?<refresh_url>https?:\/\/[^\s\]]+)\])?$/
];

let tokens = [];
let proxies = [];
let currentTokenIndex = 0;
let currentProxyIndex = 0;

const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY || '';
const SITE_KEY = '0x4AAAAAABDpOwOAt5nJkp9b';
const PAGE_URL = 'https://app.flow3.tech';
const DEFAULT_REFERRAL_CODE = 'SKvUHwtgvy';

class Capsolver {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.capsolver.com';
  }

  async createTurnstileTask(sitekey, pageurl) {
    const data = {
      clientKey: this.apiKey,
      task: {
        type: 'AntiTurnstileTaskProxyLess',
        websiteURL: pageurl,
        websiteKey: sitekey
      }
    };

    try {
      const response = await axios.post(`${this.baseUrl}/createTask`, data, { timeout: 30000 });
      const result = response.data;

      if (result.taskId) {
        return result.taskId;
      }

      console.error(`${colors.red}${emojis.error} Error creating Turnstile task:${colors.reset}`, result);
      return null;
    } catch (error) {
      console.error(`${colors.red}${emojis.error} Error creating Turnstile task:${colors.reset}`, error.message);
      return null;
    }
  }

  async getTaskResult(taskId) {
    const data = { clientKey: this.apiKey, taskId };

    const maxAttempts = 30;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await axios.post(`${this.baseUrl}/getTaskResult`, data, { timeout: 30000 });
        const result = response.data;

        if (result.status === 'ready') {
          return result.solution.token || result.solution.gRecaptchaResponse;
        } else if (result.errorId !== 0) {
          console.error(`${colors.red}${emojis.error} Error getting Turnstile result:${colors.reset}`, result);
          return null;
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error(`${colors.red}${emojis.error} Error getting Turnstile result:${colors.reset}`, error.message);
        return null;
      }
    }

    console.error(`${colors.red}${emojis.error} Max polling attempts reached for task ${taskId}${colors.reset}`);
    return null;
  }

  async solveTurnstile(sitekey, pageurl) {
    const taskId = await this.createTurnstileTask(sitekey, pageurl);
    if (!taskId) return null;
    return await this.getTaskResult(taskId);
  }
}

async function loadTokens(filePath) {
  try {
    const tokenContent = await fs.readFile(filePath, 'utf8');
    const tokenList = tokenContent.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map((line, index) => {
        try {
          // For newtoken.txt, expect JSON: {"token":"...","email":"...","password":"...","walletAddress":"..."?}
          if (filePath === 'newtoken.txt') {
            const parsed = JSON.parse(line);
            if (!parsed.token || !parsed.email || !parsed.password) {
              throw new Error('Missing token, email, or password');
            }
            return {
              token: parsed.token,
              email: parsed.email,
              password: parsed.password,
              walletAddress: parsed.walletAddress || null
            };
          }
          // For token.txt, treat as raw token
          return { token: line, email: `Token_${index + 1}`, password: null, walletAddress: null };
        } catch (error) {
          console.error(`${colors.red}${emojis.error} Invalid line in ${filePath} at line ${index + 1}:${colors.reset}`, error.message);
          return null;
        }
      })
      .filter(item => item !== null);
    
    if (!tokenList.length) {
      throw new Error(`Token file ${filePath} is empty or contains no valid entries`);
    }
    
    console.log(`${colors.green}${emojis.key} Loaded ${colors.bright}${tokenList.length}${colors.reset}${colors.green} tokens successfully from ${filePath}${colors.reset}`);
    
    return tokenList;
  } catch (error) {
    console.error(`${colors.red}${emojis.error} Error reading tokens from ${filePath}:${colors.reset}`, error.message);
    console.error(`${colors.yellow}${emojis.warning} Please ensure ${filePath} exists and contains valid entries${colors.reset}`);
    return [];
  }
}

async function loadProxies() {
  try {
    const proxyContent = await fs.readFile('proxies.txt', 'utf8');
    const proxyList = proxyContent.split('\n')
      .map(proxy => proxy.trim())
      .filter(proxy => proxy.length > 0)
      .map(parseProxy)
      .filter(proxy => proxy !== null);
    
    if (proxyList.length > 0) {
      console.log(`${colors.green}${emojis.network} Loaded ${colors.bright}${proxyList.length}${colors.reset}${colors.green} proxies from proxies.txt${colors.reset}`);
    } else {
      console.log(`${colors.yellow}${emojis.warning} No proxies found in proxies.txt. Running without proxies.${colors.reset}`);
    }
    
    return proxyList;
  } catch (error) {
    console.error(`${colors.yellow}${emojis.warning} Error reading proxies:${colors.reset}`, error.message);
    console.log(`${colors.yellow}${emojis.warning} Running without proxies.${colors.reset}`);
    return [];
  }
}

function parseProxy(proxyString) {
  try {
    if (!proxyString) {
      throw new Error('Proxy cannot be an empty string');
    }

    for (const pattern of PROXY_FORMATS_REGEXP) {
      const match = proxyString.match(pattern);
      if (match) {
        const groups = match.groups;
        const port = parseInt(groups.port);
        
        if (port < 1 || port > 65535) {
          throw new Error(`Invalid port: ${port}. Must be between 1 and 65535`);
        }

        const host = groups.host;
        const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
        const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!ipRegex.test(host) && !domainRegex.test(host)) {
          throw new Error(`Invalid host: ${host}. Must be a valid IP or domain`);
        }

        const protocol = groups.protocol || 'http';
        if (!['http', 'https'].includes(protocol)) {
          throw new Error(`Invalid protocol: ${protocol}. Only http and https are supported`);
        }

        if (groups.refresh_url) {
          const urlRegex = /^https?:\/\/[^\s]+$/;
          if (!urlRegex.test(groups.refresh_url)) {
            throw new Error(`Invalid refresh_url: ${groups.refresh_url}`);
          }
        }

        const formattedProxy = groups.login && groups.password
          ? `http://${groups.login}:${groups.password}@${host}:${port}`
          : `http://${host}:${port}`;

        return {
          formattedProxy,
          original: proxyString,
          refresh_url: groups.refresh_url || null
        };
      }
    }

    throw new Error(`Unsupported proxy format: ${proxyString}`);
  } catch (error) {
    console.error(`${colors.red}${emojis.error} Error parsing proxy ${proxyString}:${colors.reset}`, error.message);
    fs.appendFile('failed_proxies.txt', `${proxyString}\n`, () => {});
    return null;
  }
}

function getNextToken() {
  const token = tokens[currentTokenIndex];
  currentTokenIndex = (currentTokenIndex + 1) % tokens.length;
  return token;
}

function getNextProxy() {
  if (proxies.length === 0) return null;
  const proxy = proxies[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % proxies.length;
  return proxy;
}

async function getUserInput(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${colors.cyan}${prompt}${colors.reset}`, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function createAccount(capsolver, referralCode) {
  const email = await getUserInput('Enter Gmail address: ');
  const password = await getUserInput('Enter password: ');

  if (!email || !password) {
    console.error(`${colors.red}${emojis.error} Email and password are required${colors.reset}`);
    return null;
  }

  const captchaToken = await capsolver.solveTurnstile(SITE_KEY, PAGE_URL);

  if (!captchaToken) {
    console.error(`${colors.red}${emojis.error} Failed to solve CAPTCHA for account creation${colors.reset}`);
    return null;
  }

  const payload = {
    email,
    password,
    referralCode,
    captchaToken
  };

  try {
    const response = await axios.post('https://api2.flow3.tech/api/user/register', payload, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Content-Type': 'application/json',
        'sec-ch-ua-platform': 'Windows',
        'sec-ch-ua': '"Brave";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
        'sec-ch-ua-mobile': '?0',
        'sec-gpc': '1',
        'accept-language': 'en-US,en;q=0.5',
        'origin': 'https://app.flow3.tech',
        'sec-fetch-site': 'same-site',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'referer': 'https://app.flow3.tech/',
        'priority': 'u=1, i'
      }
    });

    if (response.data.result === 'success' && response.data.data.accessToken) {
      console.log(`${colors.green}${emojis.success} Account created successfully: ${colors.bright}${email}${colors.reset}`);
      const entry = { token: response.data.data.accessToken, email, password, walletAddress: null };
      await fs.appendFile('newtoken.txt', `${JSON.stringify(entry)}\n`);
      return entry;
    } else {
      console.error(`${colors.red}${emojis.error} Account creation failed:${colors.reset}`, response.data);
      return null;
    }
  } catch (error) {
    console.error(`${colors.red}${emojis.error} Error creating account:${colors.reset}`, error.message);
    if (error.response) {
      console.error(`${colors.red}Error details:${colors.reset}`, error.response.data);
    }
    return null;
  }
}

function createAxiosInstance(token, proxy = null) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Content-Type': 'application/json',
    'sec-ch-ua-platform': 'Windows',
    'authorization': `Bearer ${token}`,
    'sec-ch-ua': '"Brave";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
    'sec-ch-ua-mobile': '?0',
    'sec-gpc': '1',
    'accept-language': 'en-US,en;q=0.5',
    'origin': 'https://app.flow3.tech',
    'sec-fetch-site': 'same-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'referer': 'https://app.flow3.tech/',
    'priority': 'u=1, i'
  };

  const axiosConfig = {
    headers,
    httpsAgent: proxy ? new HttpsProxyAgent(proxy.formattedProxy, {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    }) : new require('https').Agent({
      minVersion: 'TLSv1.2'
    })
  };

  if (proxy) {
    console.log(`${colors.cyan}${emojis.network} Using proxy: ${colors.bright}${proxy.formattedProxy}${colors.reset}${proxy.refresh_url ? ` [${proxy.refresh_url}]` : ''}`);
  } else {
    console.log(`${colors.yellow}${emojis.warning} No proxy used for this request${colors.reset}`);
  }

  return axios.create(axiosConfig);
}

async function connectSolanaWallet(axiosInstance, tokenEntry, tokenIndex) {
  const { token, email, walletAddress } = tokenEntry;

  // Skip if walletAddress is already set and valid
  if (walletAddress && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
    console.log(`${colors.green}${emojis.wallet} Solana wallet already linked for ${email}: ${walletAddress}${colors.reset}`);
    return true;
  }

  console.log(`${colors.yellow}${emojis.pending} No Solana wallet linked for ${email}. Generating new wallet...${colors.reset}`);

  // Generate new Solana wallet
  try {
    const keypair = Keypair.generate();
    const newWalletAddress = keypair.publicKey.toBase58();
    const privateKey = Buffer.from(keypair.secretKey).toString('base64');

    console.log(`${colors.cyan}${emojis.wallet} Generated new Solana wallet:${colors.reset}`);
    console.log(`${colors.cyan}  Public Key: ${colors.bright}${newWalletAddress}${colors.reset}`);
    console.log(`${colors.yellow}  Private Key: ${colors.bright}${privateKey}${colors.reset} (Save securely, not stored in newtoken.txt)`);

    // Connect wallet via API
    const payload = { walletAddress: newWalletAddress };
    const response = await axiosInstance.post('https://api2.flow3.tech/api/user/update-wallet-address', payload);

    if (response.data.result === 'success') {
      console.log(`${colors.green}${emojis.success} Solana wallet ${newWalletAddress} linked successfully for ${email}${colors.reset}`);

      // Update newtoken.txt with new walletAddress
      try {
        const tokenContent = await fs.readFile('newtoken.txt', 'utf8');
        const tokenLines = tokenContent.split('\n').filter(line => line.trim());
        const updatedLines = tokenLines.map(line => {
          try {
            const parsed = JSON.parse(line);
            if (parsed.token === token && parsed.email === email) {
              return JSON.stringify({ ...parsed, walletAddress: newWalletAddress });
            }
            return line;
          } catch (error) {
            return line;
          }
        });

        await fs.writeFile('newtoken.txt', updatedLines.join('\n') + '\n');
        console.log(`${colors.green}${emojis.success} Updated newtoken.txt with walletAddress for ${email}${colors.reset}`);

        // Update in-memory token entry
        tokenEntry.walletAddress = newWalletAddress;
        return true;
      } catch (error) {
        console.error(`${colors.red}${emojis.error} Error updating newtoken.txt:${colors.reset}`, error.message);
        return false;
      }
    } else {
      console.error(`${colors.red}${emojis.error} Failed to link Solana wallet for ${email}:${colors.reset}`, response.data);
      return false;
    }
  } catch (error) {
    console.error(`${colors.red}${emojis.error} Error generating or linking Solana wallet for ${email}:${colors.reset}`, error.message);
    if (error.response) {
      console.error(`${colors.red}Error details:${colors.reset}`, error.response.data);
    }
    return false;
  }
}

function printBanner() {
  const bannerLines = [
    `${colors.cyan}----------------------------------------${colors.reset}`,
    `${colors.cyan}${colors.reset}  ${colors.bright}${colors.white}FLOW3 AUTO TASK - AIRDROP INSIDERS${colors.reset}  ${colors.cyan}${colors.reset}`,
    `${colors.cyan}----------------------------------------${colors.reset}`
  ];

  console.log('\n' + bannerLines.join('\n') + '\n');
}

async function getPointStats(axiosInstance) {
  try {
    const response = await axiosInstance.get('https://api2.flow3.tech/api/user/get-point-stats');
    return response.data.data;
  } catch (error) {
    console.error(`${colors.red}${emojis.error} Error fetching point stats:${colors.reset}`, error.message);
    if (error.response) {
      console.error(`${colors.red}Error details:${colors.reset}`, error.response.data);
    }
    return null;
  }
}

async function getTasks(axiosInstance) {
  try {
    const response = await axiosInstance.get('https://api2.flow3.tech/api/task/get-user-task');
    return response.data.data;
  } catch (error) {
    console.error(`${colors.red}${emojis.error} Error fetching tasks:${colors.reset}`, error.message);
    if (error.response) {
      console.error(`${colors.red}Error details:${colors.reset}`, error.response.data);
    }
    return [];
  }
}

async function claimTask(axiosInstance, taskId) {
  try {
    const response = await axiosInstance.post(
      'https://api2.flow3.tech/api/task/claim-task',
      { taskId }
    );

    if (response.data.result === 'success') {
      console.log(`${colors.green}${emojis.success} Task ${taskId} claimed successfully!${colors.reset}`);
      return true;
    } else {
      console.log(`${colors.yellow}${emojis.warning} Task ${taskId} claim response: ${JSON.stringify(response.data)}${colors.reset}`);
      return false;
    }
  } catch (error) {
    console.error(`${colors.red}${emojis.error} Error claiming task ${taskId}:${colors.reset}`, error.message);
    if (error.response) {
      console.error(`${colors.red}Error details:${colors.reset}`, error.response.data);
    }
    return false;
  }
}

function printPointStats(stats, tokenIndex, email) {
  if (!stats) {
    console.log(`${colors.yellow}${emojis.warning} No point stats available for token #${tokenIndex + 1} (${email})${colors.reset}`);
    return;
  }

  console.log(`\n${colors.cyan}${emojis.money} BALANCE INFORMATION (TOKEN #${tokenIndex + 1} - ${email}) ${emojis.money}${colors.reset}`);
  console.log(`${colors.cyan}------------------------------------------${colors.reset}`);
  console.log(`${colors.white}${emojis.star} Total Points:         ${colors.green}${stats.totalPointEarned.toFixed(2)}${colors.reset}`);
  console.log(`${colors.white}${emojis.check} Task Points:          ${colors.green}${stats.totalPointTask.toFixed(2)}${colors.reset}`);
  console.log(`${colors.white}${emojis.rocket} Internet Points:      ${colors.green}${stats.totalPointInternet.toFixed(2)}${colors.reset}`);
  console.log(`${colors.white}${emojis.info} Referral Points:      ${colors.green}${stats.totalPointReferral.toFixed(2)}${colors.reset}`);
  console.log(`${colors.white}${emojis.time} Today's Earnings:     ${colors.green}${stats.todayPointEarned.toFixed(2)}${colors.reset}`);
  console.log(`${colors.white}${emojis.money} Earning Rate:         ${colors.green}${stats.earningRate.toFixed(2)}/day${colors.reset}`);
  console.log(`${colors.cyan}------------------------------------------${colors.reset}\n`);
}

async function processTokenTasks(tokenEntry, tokenIndex, useProxy = true) {
  const { token, email } = tokenEntry;
  let attempts = 0;
  const maxAttempts = useProxy ? proxies.length || 1 : 1;
  let proxyFailed = false;

  while (attempts < maxAttempts) {
    try {
      console.log(`\n${colors.white}${emojis.key} Processing Token #${tokenIndex + 1} (${email})${colors.reset}`);

      const proxy = useProxy ? getNextProxy() : null;
      const axiosInstance = createAxiosInstance(token, proxy);

      // Process existing tasks (retweet, like, comment, etc.)
      const tasks = await getTasks(axiosInstance);
      console.log(`${colors.white}${emojis.info} Found ${colors.yellow}${tasks.length}${colors.white} tasks for token #${tokenIndex + 1} (${email})${colors.reset}`);

      let claimedCount = 0;
      let failedCount = 0;
      let alreadyClaimedCount = 0;

      for (const task of tasks) {
        const statusColor =
          task.status === 'idle' ? colors.yellow :
          task.status === 'pending' ? colors.cyan :
          task.status === 'claimed' ? colors.green : colors.white;

        const statusEmoji =
          task.status === 'idle' ? emojis.pending :
          task.status === 'pending' ? emojis.pending :
          task.status === 'claimed' ? emojis.success : emojis.info;

        console.log(`${colors.white}${emojis.info} Processing: ${colors.bright}${task.name}${colors.reset} ${colors.white}(${statusColor}${task.status} ${statusEmoji}${colors.white}) - ${colors.green}${task.pointAmount} points${colors.reset}`);

        const claimResult = await claimTask(axiosInstance, task._id);

        if (claimResult) {
          claimedCount++;
        } else if (task.status === 'claimed') {
          alreadyClaimedCount++;
        } else {
          failedCount++;
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      console.log(`\n${colors.white}${emojis.info} Task processing summary for token #${tokenIndex + 1} (${email}):${colors.reset}`);
      console.log(`${colors.green}${emojis.success} Successfully claimed: ${claimedCount}${colors.reset}`);
      console.log(`${colors.yellow}${emojis.pending} Already claimed: ${alreadyClaimedCount}${colors.reset}`);
      console.log(`${colors.red}${emojis.error} Failed to claim: ${failedCount}${colors.reset}`);

      // Process Solana wallet connection task
      console.log(`${colors.white}${emojis.wallet} Checking Solana wallet connection for ${email}...${colors.reset}`);
      const walletConnected = await connectSolanaWallet(axiosInstance, tokenEntry, tokenIndex);
      if (!walletConnected) {
        console.error(`${colors.red}${emojis.error} Failed to connect Solana wallet for ${email}${colors.reset}`);
      }

      const pointStats = await getPointStats(axiosInstance);
      printPointStats(pointStats, tokenIndex, email);

      return { claimedCount, alreadyClaimedCount, failedCount };
    } catch (error) {
      console.error(`${colors.red}${emojis.error} Attempt ${attempts + 1} failed for token #${tokenIndex + 1} (${email}):${colors.reset}`, error.message);
      if (proxy) {
        fs.appendFile('failed_proxies.txt', `${proxy.original}\n`, () => {});
      }
      attempts++;
      if (attempts < maxAttempts) {
        console.log(`${colors.yellow}${emojis.pending} Retrying with a different proxy...${colors.reset}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else if (useProxy && !proxyFailed) {
        console.log(`${colors.yellow}${emojis.warning} All proxies failed. Retrying without proxy...${colors.reset}`);
        proxyFailed = true;
        attempts = 0;
        useProxy = false;
      } else {
        console.error(`${colors.red}${emojis.error} All attempts failed for token #${tokenIndex + 1} (${email})${colors.reset}`);
        return { claimedCount: 0, alreadyClaimedCount: 0, failedCount: 0 };
      }
    }
  }
}

async function reloadTokensAndProxies(tokenFile) {
  try {
    const newTokens = await loadTokens(tokenFile);
    const newProxies = await loadProxies();

    tokens = newTokens;
    proxies = newProxies;

    console.log(`${colors.green}${emojis.change} Tokens and proxies reloaded successfully from ${tokenFile}${colors.reset}`);
    return true;
  } catch (error) {
    console.error(`${colors.red}${emojis.error} Error reloading tokens and proxies:${colors.reset}`, error.message);
    return false;
  }
}

async function runBot(tokenFile = 'token.txt') {
  printBanner();
  console.log(`${colors.green}${emojis.rocket} Starting Flow3 Multi-Token Task Bot with ${tokenFile}...${colors.reset}`);

  tokens = await loadTokens(tokenFile);
  if (tokens.length === 0) {
    console.error(`${colors.red}${emojis.error} No valid tokens found. Returning to menu.${colors.reset}`);
    return;
  }
  proxies = await loadProxies();

  let cycleCount = 1;

  while (true) {
    try {
      console.log(`\n${colors.white}${emojis.time} Starting cycle #${cycleCount}${colors.reset}`);
      console.log(`${colors.white}${'-'.repeat(50)}${colors.reset}`);

      await reloadTokensAndProxies(tokenFile);

      if (tokens.length === 0) {
        console.error(`${colors.red}${emojis.error} No valid tokens found. Stopping automation.${colors.reset}`);
        break;
      }

      let totalClaimed = 0;
      let totalAlreadyClaimed = 0;
      let totalFailed = 0;

      for (let i = 0; i < tokens.length; i++) {
        const result = await processTokenTasks(tokens[i], i, proxies.length > 0);
        totalClaimed += result.claimedCount;
        totalAlreadyClaimed += result.alreadyClaimedCount;
        totalFailed += result.failedCount;

        if (i < tokens.length - 1) {
          console.log(`${colors.yellow}${emojis.time} Waiting 5 seconds before processing next token...${colors.reset}`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      console.log(`\n${colors.white}${emojis.info} CYCLE #${cycleCount} TOTAL SUMMARY:${colors.reset}`);
      console.log(`${colors.white}${'-'.repeat(50)}${colors.reset}`);
      console.log(`${colors.green}${emojis.success} Total successfully claimed: ${totalClaimed}${colors.reset}`);
      console.log(`${colors.yellow}${emojis.pending} Total already claimed: ${totalAlreadyClaimed}${colors.reset}`);
      console.log(`${colors.red}${emojis.error} Total failed to claim: ${totalFailed}${colors.reset}`);
      console.log(`${colors.white}${'-'.repeat(50)}${colors.reset}`);

      const waitSeconds = 30;
      console.log(`${colors.yellow}${emojis.time} Waiting ${waitSeconds} seconds before next cycle...${colors.reset}`);

      for (let i = waitSeconds; i > 0; i--) {
        process.stdout.write(`\r${colors.yellow}${emojis.time} Next cycle in: ${colors.bright}${i}${colors.reset} seconds`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      process.stdout.write('\r' + ' '.repeat(60) + '\r');

      cycleCount++;
    } catch (error) {
      console.error(`${colors.red}${emojis.error} Error in main bot loop:${colors.reset}`, error.message);
      console.log(`${colors.yellow}${emojis.pending} Waiting 30 seconds before retrying...${colors.reset}`);
      await new Promise(resolve => setTimeout(resolve, 30 * 1000));
    }
  }
}

async function runAccountCreation() {
  printBanner();
  console.log(`${colors.green}${emojis.rocket} Starting Flow3 Account Creation...${colors.reset}`);

  if (!CAPSOLVER_API_KEY) {
    console.error(`${colors.red}${emojis.error} CAPSOLVER_API_KEY environment variable not set${colors.reset}`);
    return;
  }

  const capsolver = new Capsolver(CAPSOLVER_API_KEY);
  const numAccounts = await new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${colors.cyan}How many accounts to create? ${colors.reset}`, answer => {
      rl.close();
      resolve(parseInt(answer) || 1);
    });
  });

  console.log(`${colors.white}${emojis.info} Creating ${colors.bright}${numAccounts}${colors.white} accounts...${colors.reset}`);

  let successCount = 0;
  for (let i = 0; i < numAccounts; i++) {
    console.log(`\n${colors.white}${emojis.key} Creating account #${i + 1}${colors.reset}`);
    const entry = await createAccount(capsolver, DEFAULT_REFERRAL_CODE);
    if (entry) successCount++;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n${colors.white}${emojis.info} Account Creation Summary:${colors.reset}`);
  console.log(`${colors.green}${emojis.success} Successfully created: ${successCount}${colors.reset}`);
  console.log(`${colors.red}${emojis.error} Failed: ${numAccounts - successCount}${colors.reset}`);
}

async function showMenu() {
  printBanner();
  console.log(`${colors.cyan}${emojis.info} Flow3 Auto Task Menu${colors.reset}`);
  console.log(`${colors.white}1. Run Task Automation (token.txt)${colors.reset}`);
  console.log(`${colors.white}2. Create New Accounts${colors.reset}`);
  console.log(`${colors.white}3. Run Task Automation (newtoken.txt)${colors.reset}`);
  console.log(`${colors.white}4. Exit${colors.reset}`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const choice = await new Promise(resolve => {
    rl.question(`${colors.cyan}Select an option (1-4): ${colors.reset}`, answer => {
      rl.close();
      resolve(answer);
    });
  });

  return choice;
}

async function main() {
  while (true) {
    const choice = await showMenu();

    if (choice === '1') {
      await runBot('token.txt');
    } else if (choice === '2') {
      await runAccountCreation();
    } else if (choice === '3') {
      await runBot('newtoken.txt');
    } else if (choice === '4') {
      console.log(`${colors.green}${emojis.success} Exiting Flow3 Auto Task Bot${colors.reset}`);
      process.exit(0);
    } else {
      console.error(`${colors.red}${emojis.error} Invalid option. Please select 1, 2, 3, or 4.${colors.reset}`);
    }

    console.log(`${colors.yellow}${emojis.time} Returning to menu in 5 seconds...${colors.reset}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

main().catch(error => {
  console.error(`${colors.red}${emojis.error} Fatal error:${colors.reset}`, error);
  process.exit(1);
});
