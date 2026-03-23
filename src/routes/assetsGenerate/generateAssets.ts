import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
// 生成资产图片
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    type: z.enum(["role", "scene", "tool", "storyboard"]),
    projectId: z.number(),
    name: z.string(),
    base64: z.string().optional().nullable(),
    prompt: z.string(),
    model: z.string(),
    resolution: z.string(),
  }),
  async (req, res) => {
    const { id, type, projectId, base64, prompt, name, model, resolution } = req.body;
    //获取风格
    const project = await u.db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
    if (!project) return res.status(500).send(success({ message: "项目为空" }));
    const role = (await u.getPrompts("role-generateImage")) ?? "";
    const scene = (await u.getPrompts("scene-generateImage")) ?? "";
    const tool = (await u.getPrompts("tool-generateImage")) ?? "";

    let systemPrompt = "";
    let userPrompt = "";
    if (type == "role") {
      systemPrompt = role;
      userPrompt = `
    请根据以下参数生成角色标准四视图：

    **基础参数：**
    - 画风风格: ${project?.artStyle || "未指定"}

    **角色设定：**
    - 名称:${name},
    - 提示词:${prompt},

    请严格按照系统规范生成人物角色四视图。
      `;
    }
    if (type == "scene") {
      systemPrompt = scene;
      userPrompt = `
    请根据以下参数生成标准场景图：

    **基础参数：**
    - 画风风格: ${project?.artStyle || "未指定"}

    **场景设定：**
    - 名称:${name},
    - 提示词:${prompt},

    请严格按照系统规范生成标准场景图。
      `;
    }
    if (type == "tool") {
      systemPrompt = tool;
      userPrompt = `
      请根据以下参数生成标准道具图：

    **基础参数：**
    - 画风风格: ${project?.artStyle || "未指定"}

    **道具设定：**
    - 名称:${name},
    - 提示词:${prompt},

    请严格按照系统规范生成标准道具图。
      `;
    }
    const [imageId] = await u.db("o_image").insert({
      type: type,
      state: "生成中",
      assetsId: id,
    });
    let taskClass = "";
    if (type == "role") taskClass = "角色图生成";
    if (type == "scene") taskClass = "场景图生成";
    if (type == "tool") taskClass = "道具图生成";

    try {
      let imagePath;
      let insertType;
      let describe;
      let relatedObjects = {};

      if (type == "role") {
        insertType = "role";
        imagePath = `/${projectId}/role/${uuidv4()}.jpg`;
        describe = `生成角色图，名称：${name}，提示词：${prompt}`;
        relatedObjects = {
          id: id,
          projectId,
          type: "角色",
        };
      }
      if (type == "scene") {
        insertType = "scene";
        imagePath = `/${projectId}/scene/${uuidv4()}.jpg`;
        describe = `生成场景图，名称：${name}，提示词：${prompt}`;
        relatedObjects = {
          id: id,
          projectId,
          type: "场景",
        };
      }
      if (type == "tool") {
        insertType = "tool";
        imagePath = `/${projectId}/props/${uuidv4()}.jpg`;
        describe = `生成道具图，名称：${name}，提示词：${prompt}`;
        relatedObjects = {
          id: id,
          projectId,
          type: "道具",
        };
      }

      const aiImage = u.Ai.Image(model);
      await aiImage.run({
        systemPrompt,
        prompt: userPrompt,
        imageBase64: base64 ? [base64] : [],
        size: resolution,
        aspectRatio: "16:9",
        taskClass,
        describe: describe ?? "", // 描述
        projectId,
        relatedObjects: JSON.stringify(relatedObjects), // 相关对象信息，便于后续分析和追踪
      });
      aiImage.save(imagePath!);
      const imageData = await u.db("o_image").where("id", imageId).select("*").first();
      const modelData = model.split(":")[1];
      if (imageData) {
        await u.db("o_image").where("id", imageId).update({
          state: "生成成功",
          filePath: imagePath,
          type: insertType,
          model: modelData,
          resolution: resolution,
        });
        const path = await u.oss.getFileUrl(imagePath!);
        await u.db("o_assets").where("id", id).update({
          imageId: imageId,
        });
        return res.status(200).send(success({ path, assetsId: id }));
      } else {
        return res.status(500).send("资产已被删除");
      }
    } catch (e) {
      await u.db("o_image").where("id", imageId).update({
        state: "生成失败",
      });
      const msg = u.error(e).message || "图片生成失败";
      return res.status(400).send(error(msg));
    }
  },
);
