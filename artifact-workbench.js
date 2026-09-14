import {uid} from './domain.js';

// A conversation owns its outputs; selection never falls back to another task.
export function conversationArtifacts(state, chat) {
  const ids = new Set([...(chat?.messages || []).flatMap(m => [m.artifactId, m.posterId, m.savedArtifactId]), ...(chat?.artifactIds || [])].filter(Boolean));
  return state.artifacts.filter(a => ids.has(a.id)).sort((a,b) => (a.createdAt || '').localeCompare(b.createdAt || '') || (a.artifactVersion || 1) - (b.artifactVersion || 1));
}

export const artifactFamily = a => a.artifactGroupId || a.id;

export function selectedArtifact(state, chat) {
  const artifacts = conversationArtifacts(state, chat);
  return artifacts.find(a => a.id === chat?.selectedArtifactId) || artifacts.at(-1) || null;
}

export function versionArtifact(state, source, result, origin, request = '') {
  const group = artifactFamily(source);
  const next = {...result, id:uid(source.format === 'poster' ? 'poster' : 'doc'), artifactGroupId:group,
    artifactVersion:Math.max(1, ...state.artifacts.filter(a => artifactFamily(a) === group).map(a => a.artifactVersion || 1)) + 1,
    parentArtifactId:source.id, versionSource:origin, revisionRequest:request,
    createdAt:new Date().toISOString(), status:'review'};
  delete next.approvedAt;
  delete next.updatedAt;
  delete next.staleReason;
  return next;
}

export function attachArtifact(chat, artifact) {
  chat.artifactIds = [...new Set([...(chat.artifactIds || []), artifact.id])];
  chat.selectedArtifactId = artifact.id;
  chat.updatedAt = new Date().toISOString();
  delete chat.completedAt;
}
