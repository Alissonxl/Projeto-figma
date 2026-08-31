export interface NodeSnapshot {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  visible: boolean;
  parentLayoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
}

export function snapshotNode(node: SceneNode): NodeSnapshot {
  const parentLayoutMode = node.parent && 'layoutMode' in node.parent ? node.parent.layoutMode : undefined;
  return {
    id: node.id,
    name: node.name || 'Sem nome',
    type: node.type,
    width: node.width,
    height: node.height,
    visible: node.visible,
    ...(parentLayoutMode ? { parentLayoutMode } : {})
  };
}
