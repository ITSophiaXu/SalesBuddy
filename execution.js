export const executionStages=Object.freeze({
  received:{title:'请求已接收',detail:'服务端已校验本次输入与上下文。'},
  connecting:{title:'正在连接 Copilot',detail:'使用服务器保存的登录与模型配置。'},
  session_ready:{title:'独立会话已就绪',detail:'本次会话不开放文件、命令或外发工具。'},
  submitted:{title:'请求已提交',detail:'等待模型响应，可以随时停止。'},
  model_running:{title:'模型开始处理',detail:'已收到 Copilot 的执行开始事件。'},
  responding:{title:'正在接收模型输出',detail:'回复内容将逐步显示，完成前仍是草稿。'},
  validating:{title:'正在校验结果',detail:'检查回复格式与成果请求，不自动执行外部操作。'},
  complete:{title:'结果校验完成',detail:'本次模型请求已完成。'},
  demo:{title:'使用本地演示',detail:'当前没有调用真实模型。'},
  artifact_requested:{title:'开始准备交付物',detail:'根据对话中确认的请求生成可编辑成果。'},
  saved:{title:'成果已保存',detail:'文案或海报已进入交付物，等待人工审核。'},
  stopped:{title:'已停止',detail:'本次未完成的结果不再采用。'},
  failed:{title:'执行未完成',detail:'请查看错误提示后重试。'},
  stale:{title:'结果已失效',detail:'资料发生变化，需要依据最新事实重新生成。'}
});

export function progressEvent(stage,elapsedMs){
  if(!Object.hasOwn(executionStages,stage)||!Number.isFinite(elapsedMs)||elapsedMs<0)return null;
  return {type:'progress',stage,elapsedMs:Math.round(elapsedMs)};
}
