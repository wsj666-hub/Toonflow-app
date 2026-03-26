import express from "express";
import { success } from "@/lib/responseFormat";
const router = express.Router();

import fs from "fs";
import path from "path";

declare const __APP_VERSION__: string | undefined;

const APP_VERSION: string = (() => {
  if (typeof __APP_VERSION__ !== "undefined") {
    return __APP_VERSION__;
  }
  // 开发环境回退：从 package.json 读取
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.version;
})();

export default router.post("/", async (req, res) => {
  const tagger = "1.1.0";
  const taggerList = tagger.split(".").map(Number);
  const currentVersionList = APP_VERSION.split(".").map(Number);
  //对比Major
  if (taggerList[0] > currentVersionList[0]) {
    return res.status(200).send(success({ needUpdate: true, latestVersion: tagger, reinstall: true }));
  }
  //对比Minor
  if (taggerList[1] > currentVersionList[1]) {
    return res.status(200).send(success({ needUpdate: true, latestVersion: tagger, reinstall: true }));
  }
  //Patch
  if (taggerList[2] > currentVersionList[2]) {
    return res.status(200).send(success({ needUpdate: true, latestVersion: tagger, reinstall: false }));
  }
  return res.status(200).send(success({ needUpdate: false, latestVersion: tagger, reinstall: false }));
});
