import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import fs from "fs";
import path from "path";
const router = express.Router();

// 字段映射表
const DATA_MAP: { label: string; value: string; subDir?: string }[] = [
  { label: "README", value: "README" },
  { label: "前缀", value: "prefix" },
  { label: "角色", value: "art_character", subDir: "art_prompt" },
  { label: "角色衍生", value: "art_character_derivative", subDir: "art_prompt" },
  { label: "道具", value: "art_prop", subDir: "art_prompt" },
  { label: "道具衍生", value: "art_prop_derivative", subDir: "art_prompt" },
  { label: "场景", value: "art_scene", subDir: "art_prompt" },
  { label: "场景衍生", value: "art_scene_derivative", subDir: "art_prompt" },
  { label: "分镜", value: "art_storyboard", subDir: "art_prompt" },
  { label: "分镜视频", value: "art_storyboard_video", subDir: "art_prompt" },
  { label: "技法-导演规划", value: "director_planning", subDir: "driector_skills" },
  { label: "技法-分镜表设计", value: "director_storyboard_table", subDir: "driector_skills" },
];

// 读取 md 文件内容，文件不存在时返回空字符串
function readMd(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

// 获取 images 文件夹第一张图片的 base64，无图片返回空字符串
function readFirstImage(imagesDir: string): string {
  try {
    const files = fs.readdirSync(imagesDir);
    const imgFile = files.find((f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f));
    if (!imgFile) return "";
    const imgPath = path.join(imagesDir, imgFile);
    const ext = path.extname(imgFile).slice(1).toLowerCase();
    const mimeType = ext === "jpg" ? "jpeg" : ext;
    const base64 = fs.readFileSync(imgPath).toString("base64");
    return `data:image/${mimeType};base64,${base64}`;
  } catch {
    return "";
  }
}

// 获取视觉手册
export default router.post("/", async (req, res) => {
  try {
    const artPromptsDir = u.getPath(["skills", "art_prompts"]);

    // 读取所有风格文件夹
    const styleDirs = fs
      .readdirSync(artPromptsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const result = styleDirs.map((styleName) => {
      const styleDir = path.join(artPromptsDir, styleName);
      const imagesDir = path.join(styleDir, "images");

      const image = readFirstImage(imagesDir);

      const data = DATA_MAP.map(({ label, value, subDir }) => {
        let mdPath: string;
        if (subDir) {
          mdPath = path.join(styleDir, subDir, `${value}.md`);
        } else {
          mdPath = path.join(styleDir, `${value}.md`);
        }
        return {
          label,
          value,
          data: readMd(mdPath),
        };
      });

      return {
        name: styleName,
        image,
        data,
      };
    });
    res.status(200).send(success(result));
  } catch (err) {
    res.status(500).send({ error: String(err) });
  }
});
