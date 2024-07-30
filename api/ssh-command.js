import { Client } from 'ssh2';
import fetch from 'node-fetch';

const USERNAME = process.env.BASIC_AUTH_USERNAME;
const PASSWORD = process.env.BASIC_AUTH_PASSWORD;
const CRON_SECRET = process.env.CRON_SECRET;
const BARK = process.env.BARK;

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    if (authHeader.substring(7) === CRON_SECRET) {
      return handleRequest(req, res);
    } else {
      return res.status(401).send('Unauthorized');
    }
  }

  if (validateBasicAuth(req.headers['authorization'])) {
    return handleRequest(req, res);
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
  return res.status(401).send('Authentication required');
}

function validateBasicAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  return username === USERNAME && password === PASSWORD;
}

async function handleRequest(req, res) {
  const accounts = [];
  let index = 1;
  while (process.env[`HOST${index}`]) {
    accounts.push({
      host: process.env[`HOST${index}`],
      username: process.env[`USERNAME${index}`],
      password: process.env[`PASSWORD${index}`],
      command: process.env[`COMMAND${index}`]
    });
    index++;
  }

  // 处理每个账户
  let result = 'success';
  for (const account of accounts) {
    if (!account.command) {
      continue;
    }
    try {
      await sshConnectAndRunCommand(account);
    } catch (error) {
      result = 'failed';
      if (BARK) {
        const url = `https://api.day.app/${BARK}/Serv00 自动保活失败/账号 ${account.username} SSH 命令执行失败，请检查账号和命令是否正确?group=Serv00 自动保活&sound=silence`;
        await fetch(url);
      }
      break;
    }
  }

  res.status(200).send(result);
}

async function sshConnectAndRunCommand(account) {
  const { host, username, password, command } = account;

  const conn = new Client();

  return new Promise((resolve, reject) => {
    conn.on('ready', () => {
      console.log(`SSH 连接成功: ${username}@${host}`);
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        stream.on('close', (code, signal) => {
          console.log(`命令执行完成，code ${code}, ${signal}`);
          conn.end();
          resolve();
        }).on('data', (data) => {
          console.log('STDOUT: ' + data);
        }).stderr.on('data', (data) => {
          console.error('STDERR: ' + data);
        });
      });
    }).on('error', (err) => {
      console.error(`SSH 连接失败: ${err}`);
      reject(err);
    }).on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
      console.log(`Keyboard-interactive authentication requested: ${name}, ${instructions}`);
      finish([password]);
    }).on('change password', (message, lang, done) => {
      console.log(`Change password requested: ${message}`);
      done();
    }).connect({
      host: host,
      port: 22,
      username: username,
      password: password,
      tryKeyboard: true
    });
  });
}
