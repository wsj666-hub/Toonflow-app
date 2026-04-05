interface VendorInputConfig {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  placeholder?: string;
}

interface ImageModelConfig {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface BuiltinVendorSeed {
  id: string;
  author: string;
  description: string;
  name: string;
  icon: string;
  inputs: VendorInputConfig[];
  inputValues: Record<string, string>;
  models: ImageModelConfig[];
  code: string;
  enable: number;
  createTime: number;
}

export const LOCAL_GEMINI_IMAGE_VENDOR_ID = "localGeminiImage";

export const LOCAL_GEMINI_IMAGE_VENDOR_CODE = String.raw`interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: (
    | "singleImage"
    | "startEndRequired"
    | "endFrameOptional"
    | "startFrameOptional"
    | "text"
    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[]
  )[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: {
    title: string;
    voice: string;
  }[];
}

interface VendorConfig {
  id: string;
  author: string;
  description?: string;
  name: string;
  icon?: string;
  inputs: {
    key: string;
    label: string;
    type: "text" | "password" | "url";
    required: boolean;
    placeholder?: string;
  }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

const vendor: VendorConfig = {
  id: "localGeminiImage",
  author: "wsj",
  description:
    "本地 Gemini 图片服务，默认对接本机管理面板 http://localhost:8317/management.html#/ ，适合在 Toonflow 中直接调用本地 OpenAI 兼容图像接口。",
  name: "本地 Gemini 图片服务",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "请输入本地服务 API Key" },
    { key: "baseUrl", label: "接口路径", type: "url", required: true, placeholder: "http://127.0.0.1:8317/v1/" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "http://127.0.0.1:8317/v1/",
  },
  models: [
    {
      name: "gemini-3.1-flash-image",
      modelName: "gemini-3.1-flash-image",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
    },
  ],
};
exports.vendor = vendor;

const textRequest = (textModel: TextModel) => {
  throw new Error("当前供应商仅支持图片生成");
};
exports.textRequest = textRequest;

interface ImageConfig {
  prompt: string;
  imageBase64: string[];
  size: "1K" | "2K" | "4K";
  aspectRatio: string;
}

function normalizeBaseUrl(baseUrl: string) {
  return (baseUrl || "").replace(/\/+$/, "");
}

function resolveCandidateBaseUrls(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  const candidates = [normalized];
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(?::|\/|$)/.test(normalized)) {
    candidates.push(normalized.replace(/^http:\/\/(127\.0\.0\.1|localhost)/, "http://host.docker.internal"));
    candidates.push(normalized.replace(/^https:\/\/(127\.0\.0\.1|localhost)/, "https://host.docker.internal"));
  }
  return [...new Set(candidates)];
}

function extractFirstImageFromMd(content: string) {
  const regex = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s)]+|\/\/[^\s)]+|[^\s)]+)\)/;
  const match = content.match(regex);
  if (!match) return null;
  const raw = match[1].trim();
  const url = raw.startsWith("data:") ? raw : raw.split(/\s+/)[0];
  return url;
}

function buildImageBody(imageConfig: ImageConfig, imageModel: ImageModel) {
  const images =
    imageConfig.imageBase64 && imageConfig.imageBase64.length
      ? [
          {
            role: "user",
            content: imageConfig.imageBase64.map((image) => ({
              type: "image_url",
              image_url: {
                url: image,
              },
            })),
          },
        ]
      : [];

  return {
    model: imageModel.modelName,
    messages: [{ role: "user", content: imageConfig.prompt + " 请直接输出图片" }, ...images],
    extra_body: {
      google: {
        image_config: {
          aspect_ratio: imageConfig.aspectRatio,
          image_size: imageConfig.size,
        },
      },
    },
  };
}

async function getAvailableModels(baseUrl: string, apiKey: string) {
  const response = await fetch(baseUrl + "/models", {
    headers: {
      Authorization: "Bearer " + apiKey,
    },
  });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data?.data) ? data.data.map((item) => item?.id).filter(Boolean) : [];
}

function formatServiceError(errorText: string, imageModel: ImageModel, availableModels: string[]) {
  if (errorText.includes("auth_unavailable: no auth available")) {
    return (
      "本地 8317 服务已收到请求，但当前没有可用的上游鉴权可供模型调用。" +
      "请在 management 页面为该模型绑定可用 auth，或改用当前 /models 已暴露的可用模型。"
    );
  }

  if (availableModels.length && !availableModels.includes(imageModel.modelName)) {
    return (
      "当前本地服务未暴露模型 " +
      imageModel.modelName +
      "。/v1/models 返回的模型有: " +
      availableModels.join(", ")
    );
  }

  return errorText;
}

const imageRequest = async (imageConfig: ImageConfig, imageModel: ImageModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");

  const apiKey = vendor.inputValues.apiKey.replace("Bearer ", "");
  const body = JSON.stringify(buildImageBody(imageConfig, imageModel));
  let lastError = null;

  for (const baseUrl of resolveCandidateBaseUrls(vendor.inputValues.baseUrl)) {
    try {
      const availableModels = await getAvailableModels(baseUrl, apiKey);
      const response = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          "请求失败，状态码: " +
            response.status +
            ", 错误信息: " +
            formatServiceError(errorText, imageModel, availableModels),
        );
      }

      const data = await response.json();
      const result = extractFirstImageFromMd(data?.choices?.[0]?.message?.content ?? "");
      if (!result) {
        throw new Error("模型未返回可解析的图片结果");
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("图片请求失败");
};
exports.imageRequest = imageRequest;

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: string;
  prompt: string;
  imageBase64?: string[];
  audio?: boolean;
  mode:
    | "singleImage"
    | "multiImage"
    | "gridImage"
    | "startEndRequired"
    | "endFrameOptional"
    | "startFrameOptional"
    | "text"
    | ("videoReference" | "imageReference" | "audioReference" | "textReference")[];
}

const videoRequest = async (videoConfig: VideoConfig, videoModel: VideoModel) => {
  throw new Error("当前供应商仅支持图片生成");
};
exports.videoRequest = videoRequest;

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
}

const ttsRequest = async (ttsConfig: TTSConfig, ttsModel: TTSModel) => {
  throw new Error("当前供应商不支持语音合成");
};
exports.ttsRequest = ttsRequest;
`;

export function createLocalGeminiImageVendorSeed(
  overrides?: Partial<Pick<BuiltinVendorSeed, "inputValues" | "enable" | "createTime">>,
): BuiltinVendorSeed {
  return {
    id: LOCAL_GEMINI_IMAGE_VENDOR_ID,
    author: "wsj",
    description:
      "本地 Gemini 图片服务，默认对接本机管理面板 http://localhost:8317/management.html#/ ，适合在 Toonflow 中直接调用本地 OpenAI 兼容图像接口。",
    name: "本地 Gemini 图片服务",
    icon: "",
    inputs: [
      { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "请输入本地服务 API Key" },
      { key: "baseUrl", label: "接口路径", type: "url", required: true, placeholder: "http://127.0.0.1:8317/v1/" },
    ],
    inputValues: {
      apiKey: "",
      baseUrl: "http://127.0.0.1:8317/v1/",
      ...(overrides?.inputValues ?? {}),
    },
    models: [
      {
        name: "gemini-3.1-flash-image",
        modelName: "gemini-3.1-flash-image",
        type: "image",
        mode: ["text", "singleImage", "multiReference"],
      },
    ],
    code: LOCAL_GEMINI_IMAGE_VENDOR_CODE,
    enable: overrides?.enable ?? 0,
    createTime: overrides?.createTime ?? Date.now(),
  };
}
