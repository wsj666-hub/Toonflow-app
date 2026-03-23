import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    scriptId: z.number(),
  }),
  async (req, res) => {
    const { scriptId } = req.body;

    //查询分镜数据
    const storyboards = await u.db("o_storyboard").where("o_storyboard.scriptId", scriptId).select("*").orderBy("o_storyboard.createTime", "asc");

    const storyboardsList = await Promise.all(
      storyboards.map(async (item) => {
        return {
          ...item,
          filePath: item.filePath ? await u.oss.getFileUrl(item.filePath) : null,
        };
      }),
    );

    const storyboardIds = storyboardsList.map((s) => s.id as number);

    //查询分镜配置
    const storyboardConfigs = await u.db("o_videoConfig").whereIn("storyboardId", storyboardIds).select("*");
    const storyboardConfigsList = await Promise.all(
      storyboardConfigs.map(async (item) => {
        if (item.data) {
          const parsedData = JSON.parse(item.data);
          const dataWithFilePath = await Promise.all(
            parsedData.map(async (d: { type: string; id: number }) => {
              if (d.type === "assets" && d.id) {
                const row = await u
                  .db("o_assets")
                  .where("o_assets.id", d.id)
                  .leftJoin("o_image", "o_assets.imageId", "o_image.id")
                  .select("o_image.filePath as imageFilePath")
                  .first();
                if (row?.imageFilePath) {
                  return await u.oss.getFileUrl(row.imageFilePath);
                }
                return null;
              }
              if (d.type === "storyboard" && d.id) {
                const row = await u.db("o_storyboard").where("id", d.id).select("filePath").first();
                if (row?.filePath) {
                  return await u.oss.getFileUrl(row.filePath);
                }
                return null;
              }
              return null;
            }),
          );
          return {
            ...item,
            data: dataWithFilePath,
          };
        }
      }),
    );
    //查询视频数据
    const videos = await u.db("o_video").whereIn("storyboardId", storyboardIds).select("*");

    const videosList = await Promise.all(
      videos.map(async (item) => {
        return {
          ...item,
          filePath: item.filePath ? await u.oss.getFileUrl(item.filePath) : null,
        };
      }),
    );

    //组装数据
    const data = storyboardsList.map((storyboard) => {
      const config = storyboardConfigsList.find((item) => item?.storyboardId === storyboard.id) || null;
      return {
        ...storyboard,
        config,
        videos: videosList.filter((video) => video.storyboardId === storyboard.id),
      };
    });
    return res.status(200).send(success(data));
  },
);
