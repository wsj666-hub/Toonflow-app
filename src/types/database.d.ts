// @db-hash f8ab3a7aee659c729c770f3555728f1b
//该文件由脚本自动生成，请勿手动修改

export interface memories {
  'content': string;
  'createTime': number;
  'embedding'?: string | null;
  'id'?: string;
  'isolationKey': string;
  'relatedMessageIds'?: string | null;
  'role'?: string | null;
  'summarized'?: number | null;
  'type': string;
}
export interface o_agentDeploy {
  'desc'?: string | null;
  'disabled'?: boolean | null;
  'id'?: number;
  'key'?: string | null;
  'model'?: string | null;
  'modelName'?: string | null;
  'name'?: string | null;
  'vendorId'?: number | null;
}
export interface o_artStyle {
  'id'?: number;
  'name'?: string | null;
  'styles'?: string | null;
}
export interface o_assets {
  'describe'?: string | null;
  'id'?: number;
  'imageId'?: number | null;
  'name'?: string | null;
  'projectId'?: number | null;
  'prompt'?: string | null;
  'remark'?: string | null;
  'scriptId'?: number | null;
  'sonId'?: number | null;
  'startTime'?: number | null;
  'state'?: string | null;
  'type'?: string | null;
}
export interface o_event {
  'createTime'?: number | null;
  'detail'?: string | null;
  'id'?: number;
  'name'?: string | null;
}
export interface o_eventChapter {
  'eventId'?: number | null;
  'id'?: number;
  'novelId'?: number | null;
}
export interface o_flowData {
  'createTime'?: number | null;
  'id'?: number;
  'name'?: string | null;
}
export interface o_image {
  'assetsId'?: number | null;
  'filePath'?: string | null;
  'id'?: number;
  'model'?: string | null;
  'resolution'?: string | null;
  'state'?: string | null;
  'type'?: string | null;
}
export interface o_novel {
  'chapter'?: string | null;
  'chapterData'?: string | null;
  'chapterIndex'?: number | null;
  'createTime'?: number | null;
  'id'?: number;
  'projectId'?: number | null;
  'reel'?: string | null;
}
export interface o_outline {
  'data'?: string | null;
  'episode'?: number | null;
  'id'?: number;
  'projectId'?: number | null;
}
export interface o_outlineNovel {
  'id'?: number;
  'novelId'?: number | null;
  'outlineId'?: number | null;
}
export interface o_project {
  'artStyle'?: string | null;
  'createTime'?: number | null;
  'id'?: number | null;
  'intro'?: string | null;
  'name'?: string | null;
  'projectType'?: string | null;
  'type'?: string | null;
  'userId'?: number | null;
  'videoRatio'?: string | null;
}
export interface o_script {
  'content'?: string | null;
  'createTime'?: number | null;
  'id'?: number;
  'name'?: string | null;
  'projectId'?: number | null;
}
export interface o_setting {
  'key'?: string | null;
  'value'?: string | null;
}
export interface o_storyboard {
  'createTime'?: number | null;
  'detail'?: string | null;
  'filePath'?: string | null;
  'frameType'?: string | null;
  'id'?: number;
  'name'?: string | null;
  'prompt'?: string | null;
  'scriptId'?: number | null;
  'seconds'?: string | null;
}
export interface o_storyboardFlow {
  'flowData': string;
  'id'?: number;
  'stroryboardId': number;
}
export interface o_tasks {
  'describe'?: string | null;
  'id'?: number;
  'model'?: string | null;
  'projectId'?: number | null;
  'reason'?: string | null;
  'relatedObjects'?: string | null;
  'startTime'?: number | null;
  'state'?: string | null;
  'taskClass'?: string | null;
}
export interface o_user {
  'id'?: number;
  'name'?: string | null;
  'password'?: string | null;
}
export interface o_vendorConfig {
  'code'?: string | null;
  'createTime'?: number | null;
  'icon'?: string | null;
  'id'?: number;
  'inputs'?: string | null;
  'inputValues'?: string | null;
  'models'?: string | null;
  'name'?: string | null;
  'version'?: string | null;
}
export interface o_video {
  'errorReason'?: string | null;
  'filePath'?: string | null;
  'id'?: number;
  'scriptId'?: number | null;
  'state'?: string | null;
  'storyboardId'?: number | null;
  'time'?: number | null;
}
export interface o_videoConfig {
  'audio'?: number | null;
  'createTime'?: number | null;
  'data'?: string | null;
  'duration'?: number | null;
  'id'?: number;
  'mode'?: string | null;
  'model'?: string | null;
  'prompt'?: string | null;
  'resolution'?: string | null;
  'storyboardId'?: number | null;
  'updateTime'?: number | null;
  'videoId'?: number | null;
}

export interface DB {
  "memories": memories;
  "o_agentDeploy": o_agentDeploy;
  "o_artStyle": o_artStyle;
  "o_assets": o_assets;
  "o_event": o_event;
  "o_eventChapter": o_eventChapter;
  "o_flowData": o_flowData;
  "o_image": o_image;
  "o_novel": o_novel;
  "o_outline": o_outline;
  "o_outlineNovel": o_outlineNovel;
  "o_project": o_project;
  "o_script": o_script;
  "o_setting": o_setting;
  "o_storyboard": o_storyboard;
  "o_storyboardFlow": o_storyboardFlow;
  "o_tasks": o_tasks;
  "o_user": o_user;
  "o_vendorConfig": o_vendorConfig;
  "o_video": o_video;
  "o_videoConfig": o_videoConfig;
}
