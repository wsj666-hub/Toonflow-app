import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    scriptId: z.number(),
    projectId: z.number(),
    storyboardId: z.number(),
    prompt: z.string(),
    data: z
      .array(
        z.object({
          id: z.number(),
          type: z.string(),
        }),
      )
      .optional(),
    model: z.string(),
    duration: z.number(),
    resolution: z.string(),
    audio: z.boolean().optional(),
    mode: z.string(),
  }),
  async (req, res) => {
    const { scriptId, projectId, storyboardId, prompt, data, model, duration, resolution, audio, mode } = req.body;
    //获取生成视频比例
    const ratio = await u.db("o_project").select("videoRatio").where("id", projectId).first();
    const videoPath = `/${projectId}/video/${uuidv4()}.mp4`; //视频保存路径
    //新增
    const videoData = {
      filePath: videoPath,
      time: Date.now(),
      state: "生成中",
      scriptId,
      storyboardId,
      projectId,
    };
    const [videoId] = await u.db("o_video").insert(videoData);
    //查询分镜是否已有配置
    const config = await u.db("o_videoConfig").where({ storyboardId }).first();
    //保存配置
    if (config) {
      await u
        .db("o_videoConfig")
        .update({ audio, model, mode, data: JSON.stringify(data), resolution, duration, prompt, updateTime: Date.now() })
        .where({ id: config.id });
    } else {
      await u.db("o_videoConfig").insert({
        storyboardId,
        audio,
        model,
        mode,
        data: JSON.stringify(data),
        resolution,
        duration,
        prompt,
        createTime: Date.now(),
        updateTime: Date.now(),
      });
    }
    //查询出图片数据
    const images = await Promise.all(
      data.map(async (item: { id: number; type: string }) => {
        if (item.type === "storyboard") {
          const filePath = await u.db("o_storyboard").where("id", item.id).select("filePath").first();
          return filePath?.filePath;
        }
        if (item.type === "assets") {
          const filePath = await u
            .db("o_assets")
            .where("o_assets.id", item.id)
            .leftJoin("o_image", "o_assets.imageId", "o_image.id")
            .select("o_image.filePath")
            .first();
          return filePath?.filePath;
        }
      }),
    );
    //把images里面的图片转成base64格式
    const base64 = await Promise.all(
      images.map(async (item) => {
        if (!item) return null;
        return await u.oss.getImageBase64(item);
      }),
    );
    res.status(200).send(success(videoId));
    (async () => {
      try {
        const relatedObjects = {
          id: storyboardId,
          projectId,
          type: "视频",
        };
        const systemPrompt = `你是一个专业的视频生成引擎，能够根据用户提供的提示词、图片和参数生成高质量的视频内容。请严格按照用户的需求进行视频创作，确保输出的视频符合以下要求：
1. 视频内容必须与用户提供的提示词和图片相关联，准确反映用户的创意意图。
2. 视频质量应达到专业水平，画面清晰、流畅，符合用户指定的分辨率和时长要求。
3. 视频风格应与用户指定的模式数据相匹配，包括色彩、音乐、特效等元素。
4. 视频中应包含用户提供的图片，并在视频中适当展示，以增强视频的视觉效果。
5. 如果用户指定了音频，请确保视频中的音频与视频内容相匹配，符合用户的创意意图。`;

        const aiVideo = u.Ai.Video(model);
        await aiVideo.run(
          {
            prompt,
            imageBase64: base64.filter((item) => item !== null) as string[],
            mode,
            duration,
            aspectRatio: (ratio?.videoRatio as `${number}:${number}`) || "16:9",
            resolution,
            audio,
          },
          {
            projectId,
            taskClass: "视频生成",
            describe: "根据提示词生成视频",
            relatedObjects: JSON.stringify(relatedObjects),
          },
        );
        await aiVideo.save(videoPath);
        await u.db("o_video").where("id", videoId).update({ state: "生成成功" });
        // await u.db("o_videoConfig").where("storyboardId", storyboardId).update({ videoId, updateTime: Date.now() });
      } catch (error: any) {
        await u
          .db("o_video")
          .where("id", videoId)
          .update({
            state: "生成失败",
            errorReason: error instanceof Error ? error.message : "未知错误",
          });
      }
    })();
  },
);
