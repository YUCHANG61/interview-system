console.log("服务器启动了");

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');

const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// ====== 确保目录 ======
if (!fs.existsSync('data')) fs.mkdirSync('data');
if (!fs.existsSync('data/responses.json')) fs.writeFileSync('data/responses.json', '[]');
if (!fs.existsSync('data/sessions.json')) fs.writeFileSync('data/sessions.json', '[]');

// ====== app ======
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ====== multer（内存上传）======
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

// ====== R2 ======
const s3 = new S3Client({
  region: "auto",
  endpoint: "https://4c67128f9a2e5c9cf667ec7e309d3f95.r2.cloudflarestorage.com",
  credentials: {
  accessKeyId: process.env.R2_ACCESS_KEY,
  secretAccessKey: process.env.R2_SECRET_KEY
}
});

const BUCKET = "interviewdata";

// ====== 工具函数 ======
function readJSON(path) {
  try {
    if (!fs.existsSync(path)) return [];
    return JSON.parse(fs.readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}


function writeJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}


async function getResponsesFromR2(){

  try{
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: "responses.json"
    });

    const res = await s3.send(command);

    const text = await res.Body.transformToString();

    return JSON.parse(text);

  } catch(e){
    return [];
  }
}

async function saveResponsesToR2(data){

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: "responses.json",
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json"
  }));

}


// ====== start ======
app.post('/start', (req, res) => {
  const userId = Date.now().toString();
  const condition = Math.random() < 0.5 ? "AI" : "Human";

  let sessions = readJSON('data/sessions.json');
  sessions.push({ userId, condition });
  writeJSON('data/sessions.json', sessions);

  res.send({ userId, condition });
});

// ====== upload ======
app.post('/upload', (req, res) => {

  console.log("👉 收到 /upload 请求");

  upload.single('video')(req, res, async function (err) {

    if (err) {
      console.error("❌ multer错误:", err);
      return res.status(500).send(err.message);
    }

    try {
      if (!req.file) {
        return res.status(400).send("No file uploaded");
      }

      const { userId, questionId, condition, email, text } = req.body;
      const fileName = `${userId}_q${questionId}.webm`;

      console.log("📤 开始上传到 R2:", fileName);

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: "video/webm"
      }));

      console.log("✅ 已上传到 R2:", fileName);

      //let responses = readJSON('data/responses.json');
      //responses.push({ userId, questionId, condition, fileKey: fileName, text});
      //writeJSON('data/responses.json', responses);

      let responses = await getResponsesFromR2();

      responses.push({
        userId,
        questionId,
        condition,
        email,
        fileKey: fileName,
        text
        });

      await saveResponsesToR2(responses);

      res.send({ status: "ok" });

    } catch (e) {
      console.error("❌ R2上传失败:", e);
      res.status(500).send(e.message);
    }

  });
});

// ====== 获取视频 ======
app.get('/video/:key', async (req, res) => {
  const key = req.params.key;

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });

    res.send({ url });

  } catch (err) {
    console.error(err);
    res.status(500).send("获取视频失败");
  }
});

// ====== fallback ======
app.use((req, res) => {
  console.log("❗未匹配路由:", req.method, req.url);
  res.status(404).send("Not found");
});

// ====== 启动 ======
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("服务器运行在端口:", PORT);
});
