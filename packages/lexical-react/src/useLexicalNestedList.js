/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {
  LexicalEditor,
  LexicalNode,
  CommandListenerLowPriority,
} from 'lexical';
import type {ListItemNode} from 'lexical/ListItemNode';

import {useEffect} from 'react';
import {$getSelection} from 'lexical';
import {$createListItemNode, $isListItemNode} from 'lexical/ListItemNode';
import {$createListNode, $isListNode} from 'lexical/ListNode';

const LowPriority: CommandListenerLowPriority = 1;

function maybeIndentOrOutdent(direction: 'indent' | 'outdent'): boolean {
  const selection = $getSelection();
  if (selection === null) {
    return false;
  }
  const selectedNodes = selection.getNodes();
  let listItemNodes = [];
  if (selectedNodes.length === 0) {
    selectedNodes.push(selection.anchor.getNode());
  }
  if (selectedNodes.length === 1) {
    // Only 1 node selected. Selection may not contain the ListNodeItem so we traverse the tree to
    // find whether this is part of a ListItemNode
    const nearestListItemNode = findNearestListItemNode(selectedNodes[0]);
    if (nearestListItemNode !== null) {
      listItemNodes = [nearestListItemNode];
    }
  } else {
    listItemNodes = getUniqueListItemNodes(selectedNodes);
  }
  if (listItemNodes.length > 0) {
    if (direction === 'indent') {
      handleIndent(listItemNodes);
    } else {
      handleOutdent(listItemNodes);
    }
    return true;
  }
  return false;
}

function isNestedListNode(node: ?LexicalNode): boolean %checks {
  return $isListItemNode(node) && $isListNode(node.getFirstChild());
}

function findNearestListItemNode(node: LexicalNode): ListItemNode | null {
  let currentNode = node;
  while (currentNode !== null) {
    if ($isListItemNode(currentNode)) {
      return currentNode;
    }
    currentNode = currentNode.getParent();
  }
  return null;
}

function getUniqueListItemNodes(
  nodeList: Array<LexicalNode>,
): Array<ListItemNode> {
  const keys = new Set<ListItemNode>();
  for (let i = 0; i < nodeList.length; i++) {
    const node = nodeList[i];
    if ($isListItemNode(node)) {
      keys.add(node);
    }
  }
  return Array.from(keys);
}

function handleIndent(listItemNodes: Array<ListItemNode>): void {
  // go through each node and decide where to move it.
  listItemNodes.forEach((listItemNode) => {
    if (isNestedListNode(listItemNode)) {
      return;
    }
    const parent = listItemNode.getParent();
    const nextSibling = listItemNode.getNextSibling();
    const previousSibling = listItemNode.getPreviousSibling();
    // if there are nested lists on either side, merge them all together.
    if (isNestedListNode(nextSibling) && isNestedListNode(previousSibling)) {
      const innerList = previousSibling.getFirstChild();
      if ($isListNode(innerList)) {
        innerList.append(listItemNode);
        const nextInnerList = nextSibling.getFirstChild();
        if ($isListNode(nextInnerList)) {
          const children = nextInnerList.getChildren();
          innerList.append(...children);
          nextInnerList.remove();
        }
        innerList.getChildren().forEach((child) => child.markDirty());
      }
    } else if (isNestedListNode(nextSibling)) {
      // if the ListItemNode is next to a nested ListNode, merge them
      const innerList = nextSibling.getFirstChild();
      if ($isListNode(innerList)) {
        const firstChild = innerList.getFirstChild();
        if (firstChild !== null) {
          firstChild.insertBefore(listItemNode);
        }
        innerList.getChildren().forEach((child) => child.markDirty());
      }
    } else if (isNestedListNode(previousSibling)) {
      const innerList = previousSibling.getFirstChild();
      if ($isListNode(innerList)) {
        innerList.append(listItemNode);
        innerList.getChildren().forEach((child) => child.markDirty());
      }
    } else {
      // otherwise, we need to create a new nested ListNode
      if ($isListNode(parent)) {
        const newListItem = $createListItemNode();
        const newList = $createListNode(parent.getTag());
        newListItem.append(newList);
        newList.append(listItemNode);
        if (previousSibling) {
          previousSibling.insertAfter(newListItem);
        } else if (nextSibling) {
          nextSibling.insertBefore(newListItem);
        } else {
          parent.append(newListItem);
        }
      }
    }
    if ($isListNode(parent)) {
      parent.getChildren().forEach((child) => child.markDirty());
    }
  });
}

function handleOutdent(listItemNodes: Array<ListItemNode>): void {
  // go through each node and decide where to move it.
  listItemNodes.forEach((listItemNode) => {
    if (isNestedListNode(listItemNode)) {
      return;
    }
    const parentList = listItemNode.getParent();
    const grandparentListItem = parentList ? parentList.getParent() : undefined;
    const greatGrandparentList = grandparentListItem
      ? grandparentListItem.getParent()
      : undefined;
    // If it doesn't have these ancestors, it's not indented.
    if (
      $isListNode(greatGrandparentList) &&
      $isListItemNode(grandparentListItem) &&
      $isListNode(parentList)
    ) {
      // if it's the first child in it's parent list, insert it into the
      // great grandparent list before the grandparent
      const firstChild = parentList ? parentList.getFirstChild() : undefined;
      const lastChild = parentList ? parentList.getLastChild() : undefined;
      if (listItemNode.is(firstChild)) {
        grandparentListItem.insertBefore(listItemNode);
        if (parentList.isEmpty()) {
          grandparentListItem.remove();
        }
        // if it's the last child in it's parent list, insert it into the
        // great grandparent list after the grandparent.
      } else if (listItemNode.is(lastChild)) {
        grandparentListItem.insertAfter(listItemNode);
        if (parentList.isEmpty()) {
          grandparentListItem.remove();
        }
      } else {
        // otherwise, we need to split the siblings into two new nested lists
        const tag = parentList.getTag();
        const previousSiblingsListItem = $createListItemNode();
        const previousSiblingsList = $createListNode(tag);
        previousSiblingsListItem.append(previousSiblingsList);
        listItemNode
          .getPreviousSiblings()
          .forEach((sibling) => previousSiblingsList.append(sibling));
        const nextSiblingsListItem = $createListItemNode();
        const nextSiblingsList = $createListNode(tag);
        nextSiblingsListItem.append(nextSiblingsList);
        nextSiblingsList.append(...listItemNode.getNextSiblings());
        // put the sibling nested lists on either side of the grandparent list item in the great grandparent.
        grandparentListItem.insertBefore(previousSiblingsListItem);
        grandparentListItem.insertAfter(nextSiblingsListItem);
        // replace the grandparent list item (now between the siblings) with the outdented list item.
        grandparentListItem.replace(listItemNode);
      }
      parentList.getChildren().forEach((child) => child.markDirty());
      greatGrandparentList.getChildren().forEach((child) => child.markDirty());
    }
  });
}

export default function useLexicalNestedList(editor: LexicalEditor): void {
  useEffect(() => {
    return editor.addListener(
      'command',
      (type) => {
        if (type === 'indentContent') {
          const hasHandledIndention = maybeIndentOrOutdent('indent');
          if (hasHandledIndention) {
            return true;
          }
        } else if (type === 'outdentContent') {
          const hasHandledIndention = maybeIndentOrOutdent('outdent');
          if (hasHandledIndention) {
            return true;
          }
        }
        return false;
      },
      LowPriority,
    );
  }, [editor]);
}