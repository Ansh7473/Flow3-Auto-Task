const axios = require('axios');
const fs = require('fs/promises');
const { HttpsProxyAgent } = require('https-proxy-agent');

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
  change: '🔄'
};

// Proxy format regex patterns (adapted from Python code)
const PROXY_FORMATS_REGEXP = [
  // Format 1: [protocol://]login:password@host:port[refresh_url]
  /^(?:(?<protocol>.+):\/\/)?(?<login>[^@:]+):(?<password>[^@]+)[@](?<host>[^@:\s]+):(?<port>\d{1,5})(?:\[(?<refresh_url>https?:\/\/[^\s\]]+)\])?$/,
  // Format 2: [protocol://]host:port@login:password[refresh_url]
  /^(?:(?<protocol>.+):\/\/)?(?<host>[^@:\s]+):(?<port>\d{1,5})[@](?<login>[^@:]+):(?<password>[^@]+)(?:\[(?<refresh_url>https?:\/\/[^\s\]]+)\])?$/,
  // Format 3: [protocol://]host:port[refresh_url]
  /^(?:(?<protocol>.+):\/\/)?(?<host>[^@:\s]+):(?<port>\d{1,5})(?:\[(?<refresh_url>https?:\/\/[^\s\]]+)\])?$/
];

let tokens = [];
let proxies = [];
let currentTokenIndex = 0;
let currentProxyIndex = 0;

async function loadTokens() {
  try {
    const tokenContent = await fs.readFile('token.txt', 'utf8');
    const tokenList = tokenContent.split('\n')
      .map(token => token.trim())
      .filter(token => token.length > 0);
    
    if (!tokenList.length) {
      throw new Error('Token file is empty');
    }
    
    console.log(`${colors.green}${emojis.key} Loaded ${colors.bright}${tokenList.length}${colors.reset}${colors.green} tokens successfully from token.txt${colors.reset}`);
    
    return tokenList;
  } catch (error) {
    console.error(`${colors.red}${emojis.error} Error reading tokens from file:${colors.reset}`, error.message);
    console.error(`${colors.yellow}${emojis.warning} Please create a 'token.txt' file with one token per line${colors.reset}`);
    process.exit(1);
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
        
        // Validate port
        if (port < 1 || port > 65535) {
          throw new Error(`Invalid port: ${port}. Must be between 1 and 65535`);
        }

        // Validate host (basic IP or domain check)
        const host = groups.host;
        const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
        const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!ipRegex.test(host) && !domainRegex.test(host)) {
          throw new Error(`Invalid host: ${host}. Must be a valid IP or domain`);
        }

        // Validate protocol (if provided)
        const protocol = groups.protocol || 'http';
        if (!['http', 'https'].includes(protocol)) {
          throw new Error(`Invalid protocol: ${protocol}. Only http and https are supported`);
        }

        // Validate refresh_url (if provided)
        if (groups.refresh_url) {
          const urlRegex = /^https?:\/\/[^\s]+$/;
          if (!urlRegex.test(groups.refresh_url)) {
            throw new Error(`Invalid refresh_url: ${groups.refresh_url}`);
          }
        }

        // Format proxy as http://login:password@host:port for https-proxy-agent
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
      minVersion: 'TLSv1.2', // Force TLS 1.2 or higher
      rejectUnauthorized: true // Enforce strict SSL verification
    }) : new require('https').Agent({
      minVersion: 'TLSv1.2' // Ensure TLS 1.2 for non-proxy requests
    })
  };

  if (proxy) {
    console.log(`${colors.cyan}${emojis.network} Using proxy: ${colors.bright}${proxy.formattedProxy}${colors.reset}${proxy.refresh_url ? ` [${proxy.refresh_url}]` : ''}`);
  } else {
    console.log(`${colors.yellow}${emojis.warning} No proxy used for this request${colors.reset}`);
  }

  return axios.create(axiosConfig);
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

function printPointStats(stats, tokenIndex) {
  if (!stats) {
    console.log(`${colors.yellow}${emojis.warning} No point stats available for token #${tokenIndex + 1}${colors.reset}`);
    return;
  }

  console.log(`\n${colors.cyan}${emojis.money} BALANCE INFORMATION (TOKEN #${tokenIndex + 1}) ${emojis.money}${colors.reset}`);
  console.log(`${colors.cyan}------------------------------------------${colors.reset}`);
  console.log(`${colors.white}${emojis.star} Total Points:         ${colors.green}${stats.totalPointEarned.toFixed(2)}${colors.reset}`);
  console.log(`${colors.white}${emojis.check} Task Points:          ${colors.green}${stats.totalPointTask.toFixed(2)}${colors.reset}`);
  console.log(`${colors.white}${emojis.rocket} Internet Points:      ${colors.green}${stats.totalPointInternet.toFixed(2)}${colors.reset}`);
  console.log(`${colors.white}${emojis.info} Referral Points:      ${colors.green}${stats.totalPointReferral.toFixed(2)}${colors.reset}`);
  console.log(`${colors.white}${emojis.time} Today's Earnings:     ${colors.green}${stats.todayPointEarned.toFixed(2)}${colors.reset}`);
  console.log(`${colors.white}${emojis.money} Earning Rate:         ${colors.green}${stats.earningRate.toFixed(2)}/day${colors.reset}`);
  console.log(`${colors.cyan}------------------------------------------${colors.reset}\n`);
}

async function processTokenTasks(token, tokenIndex, useProxy = true) {
  let attempts = 0;
  const maxAttempts = useProxy ? proxies.length || 1 : 1;
  let proxyFailed = false;

  while (attempts < maxAttempts) {
    try {
      console.log(`\n${colors.white}${emojis.key} Processing Token #${tokenIndex + 1}${colors.reset}`);

      const proxy = useProxy ? getNextProxy() : null;
      const axiosInstance = createAxiosInstance(token, proxy);

      const tasks = await getTasks(axiosInstance);
      console.log(`${colors.white}${emojis.info} Found ${colors.yellow}${tasks.length}${colors.white} tasks for token #${tokenIndex + 1}${colors.reset}`);

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

      console.log(`\n${colors.white}${emojis.info} Task processing summary for token #${tokenIndex + 1}:${colors.reset}`);
      console.log(`${colors.green}${emojis.success} Successfully claimed: ${claimedCount}${colors.reset}`);
      console.log(`${colors.yellow}${emojis.pending} Already claimed: ${alreadyClaimedCount}${colors.reset}`);
      console.log(`${colors.red}${emojis.error} Failed to claim: ${failedCount}${colors.reset}`);

      const pointStats = await getPointStats(axiosInstance);
      printPointStats(pointStats, tokenIndex);

      return { claimedCount, alreadyClaimedCount, failedCount };
    } catch (error) {
      console.error(`${colors.red}${emojis.error} Attempt ${attempts + 1} failed for token #${tokenIndex + 1}:${colors.reset}`, error.message);
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
        console.error(`${colors.red}${emojis.error} All attempts failed for token #${tokenIndex + 1}${colors.reset}`);
        return { claimedCount: 0, alreadyClaimedCount: 0, failedCount: 0 };
      }
    }
  }
}

async function reloadTokensAndProxies() {
  try {
    const newTokens = await loadTokens();
    const newProxies = await loadProxies();

    tokens = newTokens;
    proxies = newProxies;

    console.log(`${colors.green}${emojis.change} Tokens and proxies reloaded successfully${colors.reset}`);
    return true;
  } catch (error) {
    console.error(`${colors.red}${emojis.error} Error reloading tokens and proxies:${colors.reset}`, error.message);
    return false;
  }
}

async function runBot() {
  printBanner();
  console.log(`${colors.green}${emojis.rocket} Starting Flow3 Multi-Token Task Bot...${colors.reset}`);

  tokens = await loadTokens();
  proxies = await loadProxies();

  let cycleCount = 1;

  while (true) {
    try {
      console.log(`\n${colors.white}${emojis.time} Starting cycle #${cycleCount}${colors.reset}`);
      console.log(`${colors.white}${'-'.repeat(50)}${colors.reset}`);

      await reloadTokensAndProxies();

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

runBot().catch(error => {
  console.error(`${colors.red}${emojis.error} Fatal error in bot:${colors.reset}`, error);
});
