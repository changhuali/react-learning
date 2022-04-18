## Fiber 架构

- 背景
  老的架构中，多个渲染任务没有优先级的概念，使得部分紧急的渲染任务可能会被其他不那么紧急的渲染任务阻塞，从而导致用户交互卡顿。
  比如一个模糊搜索页面，当用户输入时，需要同时响应用户输入和搜索结果的渲染，假如搜索结果渲染比较耗时，此时用户输入就无法及时渲染到页面上。
  为了解决上述问题，就需要让渲染任务具有优先级，并且让渲染流程可中断。

  因此`React16`引入了新的架构，新架构分为 3 层：

  - Scheduler --- 负责根据优先级进行任务的调度
  - Reconciler --- 负责 `diff`，并且其处理`虚拟DOM`的过程是可中断的
  - Renderer --- 负责根据 `diff` 结果将组件渲染到页面

- 实现
  `React`中，一个"渲染入口"最多同时存在两个`Fiber`树，已经渲染到屏幕中的内容对应的`Fiber`树称为`current Fiber`树，引发更新时，`React`会在内存中重新构建一棵新的`Fiber`树，称为`workInProgress Fiber`树。
  每个`Fiber`节点有一个`alternate`属性，用于保存其对应的`current Fiber`或`workInProgress Fiber`

下面我们通过分析`React`的`render阶段`和`commit阶段`来见识下`Fiber`在`React`中到底是如何工作的。

## render 阶段

_调用`createRoot`创建一个`ReactDOMRoot`实例_

```ts
function createRoot() {
  // 创建fiberRoot，fiberRoot是整个应用的根节点
  var root = createContainer(
    container,
    ConcurrentRoot,
    null,
    isStrictMode,
    concurrentUpdatesByDefaultOverride,
    identifierPrefix,
    onRecoverableError
  );
  // root会保存到该实例的_internalRoot属性
  return new ReactDOMRoot(root);
}
```

_`createContainer`会调用`createFiberRoot`创建并返回一个`FiberRootNode`实例_

```ts
function createFiberRoot(...略) {
  // 创建fiberRoot
  var root = new FiberRootNode(
    containerInfo,
    tag,
    hydrate,
    identifierPrefix,
    onRecoverableError
  );
  // 创建rootFiber，rootFiber是整个组件树的根节点
  var uninitializedFiber = createHostRootFiber(tag, isStrictMode);
  // 将rootFiber挂载到fiberRoot的current属性上
  root.current = uninitializedFiber;
  uninitializedFiber.stateNode = root;

  return root;
}
```

```ts
const root: FiberRootNode = {
  // ConcurrentRoot === 1 表示开启并发模式
  tag: ConcurrentRoot,
  // container === div#root
  containerInfo: container,
  // 整个组件树的根节点
  current: uninitializedFiber,
};
const uninitializedFiber = {
  // Fiber节点对应的是一个原生节点，其值为3
  tag: HostRoot,
  // 渲染模式为并发渲染
  mode: ConcurrentRoot
  // Fiber节点对应的dom信息
  stateNode: root
}
```

_`ReactDOMRoot`类有一个`render`实例方法，调用该方法会开始渲染组件树_

```ts
root.render(<App />);
```

```ts
ReactDOMRoot.prototype.render = function (children) {
  var root = this._internalRoot;
  updateContainer(children, root, null, null);
};
```

### _`updateContainer`_

```ts
function updateContainer(element, container, parentComponent, callback) {
  var current$1 = container.current;
  var eventTime = requestEventTime();
  var lane = requestUpdateLane(current$1);
  // 创建Update对象
  var update = createUpdate(eventTime, lane);
  update.payload = {
    element: element,
  };

  // 将Update对象入队到current Fiber对象的updateQueue队列
  enqueueUpdate(current$1, update);
  var root = scheduleUpdateOnFiber(current$1, lane, eventTime);

  return lane;
}
```

### `scheduleUpdateOnFiber`

```ts
function scheduleUpdateOnFiber(fiber, lane, eventTime) {
  ensureRootIsScheduled(root, eventTime);

  return root;
}
```

### _`ensureRootIsScheduled`_

```ts
function ensureRootIsScheduled(root, currentTime) {
  // 获取root的优先级
  var nextLanes = getNextLanes(
    root,
    root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes
  );
  var newCallbackPriority = getHighestPriorityLane(nextLanes);
  // 优先级为SyncLane，进入微任务队列（基于queueMocrotask或Promise）
  if (newCallbackPriority === SyncLane) {
    // 将performSyncWorkOnRoot.bind(null, root)回调函数加入到全局syncQueue队列
    scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root));
    if (ReactCurrentActQueue$1.current !== null) {
      // TODO:如何理解 Inside `act`, use our internal `act` queue so that these get flushed
      // at the end of the current scope even when using the sync version
      // of `act`.
      ReactCurrentActQueue$1.current.push(flushSyncCallbacks);
    } else {
      scheduleMicrotask(function () {
        if (executionContext === NoContext) {
          flushSyncCallbacks();
        }
      });
    }
  } else {
    // 优先级低于SyncLane，进入宏任务队列（基于setImmediate或MessageChanel）
    // scheduleCallback$2会根据当前ReactCurrentActQueue$1.current队列是否为空分别处理该任务
    // ReactCurrentActQueue$1.current不为空(TODO:何时不为空)：该任务将继续入ReactCurrentActQueue$1.current
    // ReactCurrentActQueue$1.current为空：该任务将通过Scheduler入堆（该堆是通过根据expirationTime排序的小顶堆）
    newCallbackNode = scheduleCallback$2(
      schedulerPriorityLevel,
      performConcurrentWorkOnRoot.bind(null, root)
    );
  }
}
```

小结: `ensureRootIsScheduled`会根据更新的优先级生成异步任务，优先级最高的同步任务（`SyncLane`）会以`微任务`的方式执行，其他优先级的任务均会以`宏任务`的方式按照`expirationTime`从小到大的顺序执行

`ensureRootIsScheduled`执行完成后，异步任务开始，此时会执行`performConcurrentWorkOnRoot`

`performConcurrentWorkOnRoot`内部会判断当前是走`并发模式`还是`同步模式`，初次渲染会走`同步模式`进而调用`renderRootSync`

`renderRootSync`

```ts
function renderRootSync(root, lanes) {
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    // 初始化workInProgressRoot、workInProgress、workInProgressRootRenderLanes等
    // 一些全局变量，为workLoopSync的执行做准备
    prepareFreshStack(root, lanes);
    workLoopSync();
  }
}
```

`workLoopSync`

```ts
// 开始处理workInProgress Fiber，从rootFiber开始
function workLoopSync() {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}
```

`performUnitOfWork`

```ts
function performUnitOfWork(unitOfWork) {
  var current = unitOfWork.alternate;
  next = beginWork$1(current, unitOfWork, subtreeRenderLanes);
  // 说明unitOfWork.child已处理完毕
  if (next === null) {
    // 内部会判断unitOfWork.sibling, 如果不为null, 会将其赋值给workInProgress, 并退出该函数
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}
```

`beginWork`

```ts
function beginWork(current, workInProgress, renderLanes) {
  // update
  if (current !== null) {
    var oldProps = current.memoizedProps;
    var newProps = workInProgress.pendingProps;

    if (
      oldProps !== newProps ||
      hasContextChanged() || // Force a re-render if the implementation changed due to hot reload:
      workInProgress.type !== current.type
    ) {
      didReceiveUpdate = true;
    } else {
      // 优化点：props相等且type相等则直接复用`Fiber`
      // 等价 var hasScheduledUpdateOrContext = includesSomeLane(current.lanes, renderLanes)
      // TODO: 不明白
      var hasScheduledUpdateOrContext = checkScheduledUpdateOrContext(
        current,
        renderLanes
      );

      if (
        !hasScheduledUpdateOrContext &&
        (workInProgress.flags & DidCapture) === NoFlags
      ) {
        didReceiveUpdate = false;
        return attemptEarlyBailoutIfNoScheduledUpdate(
          current,
          workInProgress,
          renderLanes
        );
      }

      if ((current.flags & ForceUpdateForLegacySuspense) !== NoFlags) {
        didReceiveUpdate = true;
      } else {
        didReceiveUpdate = false;
      }
    }
  } else {
    // mount
    didReceiveUpdate = false;

    if (getIsHydrating() && isForkedChild(workInProgress)) {
      var slotIndex = workInProgress.index;
      var numberOfForks = getForksAtLevel();
      pushTreeId(workInProgress, numberOfForks, slotIndex);
    }
  }

  workInProgress.lanes = NoLanes;

  switch (workInProgress.tag) {
    // 根据tag（表示节点类型）的值创建各自对应的Fiber
    case IndeterminateComponent:

    case LazyComponent:

    case FunctionComponent:

    case ClassComponent:

    case HostRoot:
      return updateHostRoot(current, workInProgress, renderLanes);
    case HostComponent:

    case HostText:

    case SuspenseComponent:

    case HostPortal:

    case ForwardRef:

    case Fragment:

    case Mode:

    case Profiler:

    case ContextProvider:

    case ContextConsumer:

    case MemoComponent:

    case SimpleMemoComponent:

    case IncompleteClassComponent:

    case SuspenseListComponent:

    case ScopeComponent: {
      break;
    }

    case OffscreenComponent:

    case LegacyHiddenComponent: {
      break;
    }

    case CacheComponent:
  }
}
```

`updateHostRoot`

```ts
function updateHostRoot(current, workInProgress, renderLanes) {
  var prevState = workInProgress.memoizedState;
  var prevChildren = prevState.element;
  // 将current.updateQueue拷贝到workInProgress.updateQueue
  cloneUpdateQueue(current, workInProgress);
  // 处理所有的update queue
  processUpdateQueue(workInProgress, nextProps, null, renderLanes);
  var nextState = workInProgress.memoizedState;
  var nextChildren = nextState.element;

  // 优化: 此次渲染的children和上次渲染的children相同，则跳过，由此可见日常编程中可以用useMemo包裹children做优化
  if (nextChildren === prevChildren) {
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  // 创建workInProgress Fiber的子节点
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);

  // 返回创建好的子节点，执行栈回到performUnitOfWork的时候会将它赋值给workInProgress，当执行栈回到workLoopSync时会处理该节点
  return workInProgress.child;
}
```

`processUpdateQueue`

```ts
function processUpdateQueue(workInProgress, props, instance, renderLanes) {
  var queue = workInProgress.updateQueue;
  var firstBaseUpdate = queue.firstBaseUpdate;
  var lastBaseUpdate = queue.lastBaseUpdate;

  var pendingQueue = queue.shared.pending;
  // Check if there are pending updates. If so, transfer them to the base queue.
  if (pendingQueue !== null) {
    // TODO:为何要设置为null
    queue.shared.pending = null;

    // pending queue是个环形链表，下面这个操作会将环剪开，让其变为一个普通链表
    var lastPendingUpdate = pendingQueue;
    var firstPendingUpdate = lastPendingUpdate.next;
    lastPendingUpdate.next = null;

    // 将剪开后的pending queue挂载到base queue上面
    if (lastBaseUpdate === null) {
      firstBaseUpdate = firstPendingUpdate;
    } else {
      lastBaseUpdate.next = firstPendingUpdate;
    }
    lastBaseUpdate = lastPendingUpdate;

    // 将pending queue同步到current的base queue，防止中断导致current Fiber的pending queue丢失
    var current = workInProgress.alternate;
    if (current !== null) {
      var currentQueue = current.updateQueue;
      var currentLastBaseUpdate = currentQueue.lastBaseUpdate;

      if (currentLastBaseUpdate !== lastBaseUpdate) {
        if (currentLastBaseUpdate === null) {
          currentQueue.firstBaseUpdate = firstPendingUpdate;
        } else {
          currentLastBaseUpdate.next = firstPendingUpdate;
        }

        currentQueue.lastBaseUpdate = lastPendingUpdate;
      }
    }
  }

  if (firstBaseUpdate !== null) {
    // Iterate through the list of updates to compute the result.
    var newState = queue.baseState;

    var newLanes = NoLanes;
    var newBaseState = null;
    var newFirstBaseUpdate = null;
    var newLastBaseUpdate = null;
    var update = firstBaseUpdate;

    do {
      var updateLane = update.lane;
      var updateEventTime = update.eventTime;

      // update优先级不满足调度优先级
      if (!isSubsetOfLanes(renderLanes, updateLane)) {
        // Priority is insufficient. Skip this update. If this is the first
        // skipped update, the previous update/state is the new base
        // update/state.
        var clone = {
          eventTime: updateEventTime,
          lane: updateLane,
          tag: update.tag,
          payload: update.payload,
          callback: update.callback,
          next: null,
        };

        // 将update加入到新的base queue
        if (newLastBaseUpdate === null) {
          newFirstBaseUpdate = newLastBaseUpdate = clone;
          newBaseState = newState;
        } else {
          newLastBaseUpdate = newLastBaseUpdate.next = clone;
        }

        // TODO:作用 Update the remaining priority in the queue.
        newLanes = mergeLanes(newLanes, updateLane);
      } else {
        // This update does have sufficient priority.
        // 如果新的base queue不为空，说明之前有update由于优先级不够被跳过，那么此update也应该被跳过，以保证update之间状态的连续性。
        if (newLastBaseUpdate !== null) {
          var _clone = {
            eventTime: updateEventTime,
            // This update is going to be committed so we never want uncommit
            // it. Using NoLane works because 0 is a subset of all bitmasks, so
            // this will never be skipped by the check above.
            lane: NoLane,
            tag: update.tag,
            payload: update.payload,
            callback: update.callback,
            next: null,
          };
          newLastBaseUpdate = newLastBaseUpdate.next = _clone;
        }

        // Process this update.
        // 将baseState视为prev state，然后根据prev state和update计算出新的state
        newState = getStateFromUpdate(
          workInProgress,
          queue,
          update,
          newState,
          props,
          instance
        );

        // 将含有callback的update保存到update queue的effects中
        var callback = update.callback;
        if (
          callback !== null && // If the update was already committed, we should not queue its
          // callback again.
          update.lane !== NoLane
        ) {
          workInProgress.flags |= Callback;
          var effects = queue.effects;

          if (effects === null) {
            queue.effects = [update];
          } else {
            effects.push(update);
          }
        }
      }

      update = update.next;

      if (update === null) {
        pendingQueue = queue.shared.pending;

        if (pendingQueue === null) {
          break;
        } else {
          // TODO: 什么情况下会发生
          // An update was scheduled from inside a reducer（TODO:哪种情况）. Add the new
          // pending updates to the end of the list and keep processing.
          var _lastPendingUpdate = pendingQueue; // Intentionally unsound. Pending updates form a circular list, but we
          // unravel them when transferring them to the base queue.

          var _firstPendingUpdate = _lastPendingUpdate.next;
          _lastPendingUpdate.next = null;
          update = _firstPendingUpdate;
          queue.lastBaseUpdate = _lastPendingUpdate;
          queue.shared.pending = null;
        }
      }
    } while (true);

    // 没有update被跳过
    if (newLastBaseUpdate === null) {
      newBaseState = newState;
    }

    queue.baseState = newBaseState;
    queue.firstBaseUpdate = newFirstBaseUpdate;
    queue.lastBaseUpdate = newLastBaseUpdate;
    // TODO:什么是Interleaved updates
    // Interleaved updates are stored on a separate queue. We aren't going to
    // process them during this render, but we do need to track which lanes
    // are remaining.

    var lastInterleaved = queue.shared.interleaved;

    if (lastInterleaved !== null) {
      var interleaved = lastInterleaved;

      do {
        newLanes = mergeLanes(newLanes, interleaved.lane);
        interleaved = interleaved.next;
      } while (interleaved !== lastInterleaved);
    } else if (firstBaseUpdate === null) {
      // `queue.lanes` is used for entangling transitions. We can set it back to
      // zero once the queue is empty.
      queue.shared.lanes = NoLanes;
    }
    // Set the remaining expiration time to be whatever is remaining in the queue.
    // This should be fine because the only two other things that contribute to
    // expiration time are props and context. We're already in the middle of the
    // begin phase by the time we start processing the queue, so we've already
    // dealt with the props. Context in components that specify
    // shouldComponentUpdate is tricky; but we'll have to account for
    // that regardless.

    // 标记workInProgress Fiber有哪些优先级的update被跳过
    markSkippedUpdateLanes(newLanes);
    // workInProgress Fiber还未处理完成的优先级集合, TODO:有什么作用
    workInProgress.lanes = newLanes;
    // 将计算的最终状态结果存储到memoizedState
    workInProgress.memoizedState = newState;
  }
}
```

`reconcileChildren`

```ts
function reconcileChildren(current, workInProgress, nextChildren, renderLanes) {
  if (current === null) {
    // 加载阶段
    workInProgress.child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderLanes
    );
  } else {
    // 更新阶段
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      current.child,
      nextChildren,
      renderLanes
    );
  }
}
```

`mountChildFibers`和`reconcileChildFibers`都是都是通过执行工厂函数返回的`reconcileChildFibers`函数

`reconcileChildFibers`

```ts
function reconcileChildFibers(returnFiber, currentFirstChild, newChild, lanes) {
  // newChild是否为Fragment且不含key
  var isUnkeyedTopLevelFragment =
    typeof newChild === "object" &&
    newChild !== null &&
    newChild.type === REACT_FRAGMENT_TYPE &&
    newChild.key === null;
  // 由下面可以看出，不带key的Fragment元素会直接取其children进行处理，其不会生成对应的Fiber
  if (isUnkeyedTopLevelFragment) {
    newChild = newChild.props.children;
  }

  // 根据newChild.$$typeof判断该如何处理该节点
  if (typeof newChild === "object" && newChild !== null) {
    switch (newChild.$$typeof) {
      // 自定义组件/原生组件，如<Custom />、<div />
      case REACT_ELEMENT_TYPE:
        // placeSingleChild函数会为执行reconcileSingleElement函数返回的Fiber打上Placement标记
        return placeSingleChild(
          reconcileSingleElement(
            returnFiber,
            currentFirstChild,
            newChild,
            lanes
          )
        );
      // ReactDOM.createPortal创建的元素
      case REACT_PORTAL_TYPE:
        return placeSingleChild(
          // 和reconcileSingleElement类似，只不过创建的是tag为HostPortal的Fiber
          reconcileSinglePortal(returnFiber, currentFirstChild, newChild, lanes)
        );
      // React.lazy创建的元素
      case REACT_LAZY_TYPE: {
        var payload = newChild._payload;
        var init = newChild._init; // 可能发生递归爆栈
        return reconcileChildFibers(
          returnFiber,
          currentFirstChild,
          init(payload),
          lanes
        );
      }
    }
    if (isArray(newChild)) {
      return reconcileChildrenArray(
        returnFiber,
        currentFirstChild,
        newChild,
        lanes
      );
    }
    if (getIteratorFn(newChild)) {
      return reconcileChildrenIterator(
        returnFiber,
        currentFirstChild,
        newChild,
        lanes
      );
    }
    throwOnInvalidObjectType(returnFiber, newChild);
  }
}
```

`reconcileSingleElement`

```ts
function reconcileSingleElement(
  returnFiber,
  currentFirstChild,
  element,
  lanes
) {
  var key = element.key;
  var child = currentFirstChild;

  // child !== null表示执行更新，开始单节点diff
  // 删除操作: 在returnFiber.flags上面打上ChildDeletion标记，并将child保存到returnFiber.deletions数组中
  // key不同: 对child执行删除操作，继续比较child的兄弟节点
  // key相同且type相同: 复用child，并对child的所有兄弟Fiber执行删除操作
  // key相同且type不同: 对child及其所有兄弟Fiber执行删除操作
  // Fiber复用是如何实现的: 调用 createWorkInProgress(current, element.props)，其内部会new一个新的Fiber，
  // 然后将current的属性copy到新的Fiber上，并重置index为0，重置sibling为null，重置return为returnFiber，
  // 若能复用Fiber，则会返回创建的Fiber，若不能复用则会根据element、mode、lanes创建一个全新的Fiber并返回该Fiber
  // 无论是复用还是不复用，Fiber都会被打上StaticMask标记。
  while (child !== null) {
    if (child.key === key) {
      var elementType = element.type;

      if (elementType === REACT_FRAGMENT_TYPE) {
        if (child.tag === Fragment) {
          deleteRemainingChildren(returnFiber, child.sibling);
          var existing = useFiber(child, element.props.children);
          existing.return = returnFiber;

          {
            existing._debugSource = element._source;
            existing._debugOwner = element._owner;
          }

          return existing;
        }
      } else {
        if (
          child.elementType === elementType || // Keep this check inline so it only runs on the false path:
          isCompatibleFamilyForHotReloading(child, element) || // Lazy types should reconcile their resolved type.
          // We need to do this after the Hot Reloading check above,
          // because hot reloading has different semantics than prod because
          // it doesn't resuspend. So we can't let the call below suspend.
          (typeof elementType === "object" &&
            elementType !== null &&
            elementType.$$typeof === REACT_LAZY_TYPE &&
            resolveLazy(elementType) === child.type)
        ) {
          deleteRemainingChildren(returnFiber, child.sibling);

          var _existing = useFiber(child, element.props);

          _existing.ref = coerceRef(returnFiber, child, element);
          _existing.return = returnFiber;

          {
            _existing._debugSource = element._source;
            _existing._debugOwner = element._owner;
          }

          return _existing;
        }
      } // Didn't match.

      deleteRemainingChildren(returnFiber, child);
      break;
    } else {
      deleteChild(returnFiber, child);
    }

    child = child.sibling;
  }

  if (element.type === REACT_FRAGMENT_TYPE) {
    var created = createFiberFromFragment(
      element.props.children,
      returnFiber.mode,
      lanes,
      element.key
    );
    created.return = returnFiber;
    return created;
  } else {
    // 会根据element.type创建Fiber
    // 用Fiber的elementType属性保存element.type
    // element.type类型为typeof type === function || (typeof type === object && type !== null && type.$$typeof === REACT_FORWARD_REF_TYPE)时，回调用对应的resolveXXX函数解析type值TODO:尚未找到使用场景
    // 用Fiber的tag属性表示节点类型，有下列类型
    // Fragment
    // IndeterminateComponent
    // ClassComponent
    // HostComponent
    // Mode
    // Profiler
    // SuspenseComponent
    // SuspenseListComponent
    // OffscreenComponent
    // CacheComponent
    // ContextProvider
    // ContextConsumer
    // ForwardRef
    // MemoComponent
    // LazyComponent
    var _created4 = createFiberFromElement(element, returnFiber.mode, lanes);

    _created4.ref = coerceRef(returnFiber, currentFirstChild, element);
    _created4.return = returnFiber;
    return _created4;
  }
}
```

`reconcileChildrenArray`

```ts
function reconcileChildrenArray(
  returnFiber,
  currentFirstChild,
  newChildren,
  lanes
) {
  {
    var knownKeys = null;

    for (var i = 0; i < newChildren.length; i++) {
      var child = newChildren[i];
      knownKeys = warnOnInvalidKey(child, knownKeys, returnFiber);
    }
  }

  // first newFiber
  var resultingFirstChild = null;
  // last newFiber
  var previousNewFiber = null;
  // 遍历结束后其值为第一个key不相同时的oldFiber
  var oldFiber = currentFirstChild;
  var lastPlacedIndex = 0;
  // 遍历结束后其值为第一个key不同时的child index
  var newIdx = 0;
  var nextOldFiber = null;

  // 遍历newChildren
  for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
    // TODO:条件什么情况会为true，一般来说oldFiber.index === 0
    if (oldFiber.index > newIdx) {
      nextOldFiber = oldFiber;
      oldFiber = null;
    } else {
      nextOldFiber = oldFiber.sibling;
    }

    // 内部会比较key, key和type都相同, 会返回复用的Fiber, 若key相同, type不同, 会返回新建的Fiber, 否则返回null
    var newFiber = updateSlot(
      returnFiber,
      oldFiber,
      newChildren[newIdx],
      lanes
    );

    // key不同会跳出循环
    if (newFiber === null) {
      // TODO: This breaks on empty slots like null children. That's
      // unfortunate because it triggers the slow path all the time. We need
      // a better way to communicate whether this was a miss or null,
      // boolean, undefined, etc.
      if (oldFiber === null) {
        oldFiber = nextOldFiber;
      }

      break;
    }

    // update: key相同但type不同导致未复用成功，执行删除操作（同单节点diff的删除操作）
    if (shouldTrackSideEffects) {
      if (oldFiber && newFiber.alternate === null) {
        // We matched the slot, but we didn't reuse the existing fiber, so we
        // need to delete the existing child.
        deleteChild(returnFiber, oldFiber);
      }
    }

    // 将Fiber的index属性值设为newIdx
    // mount:
    //  为新的Fiber节点打上Forked标记
    //  返回lastPlacedIndex
    // update:
    //  复用成功:
    //    复用的Fiber会被打上StaticMask标记
    //    被复用的Fiber并不会被打上Placement标记, 因为此时, oldIndex肯定不满足小于lastPlacedIndex的条件
    //    返回oldIndex
    //  复用失败:
    //    为新的Fiber节点打上Placement标记
    //    返回lastPlacedIndex
    lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);

    if (previousNewFiber === null) {
      // TODO: Move out of the loop. This only happens for the first run.
      resultingFirstChild = newFiber;
    } else {
      // TODO: Defer siblings if we're not at the right index for this slot.
      // I.e. if we had null values before, then we want to defer this
      // for each null value. However, we also don't want to call updateSlot
      // with the previous one.
      previousNewFiber.sibling = newFiber;
    }

    previousNewFiber = newFiber;
    oldFiber = nextOldFiber;
  }

  // 说明newChildren节点被全部处理, 此时剩下的old fibers全部是需要被删除的节点
  if (newIdx === newChildren.length) {
    // We've reached the end of the new children. We can delete the rest.
    deleteRemainingChildren(returnFiber, oldFiber);

    if (getIsHydrating()) {
      var numberOfForks = newIdx;
      pushTreeFork(returnFiber, numberOfForks);
    }

    return resultingFirstChild;
  }

  // oldFiber遍历完毕, 此时剩下的newChildren全是新增节点, 需要为其创建各自的全新Fiber
  if (oldFiber === null) {
    // If we don't have any more existing children we can choose a fast path
    // since the rest will all be insertions.
    for (; newIdx < newChildren.length; newIdx++) {
      var _newFiber = createChild(returnFiber, newChildren[newIdx], lanes);

      if (_newFiber === null) {
        continue;
      }

      // 一定复用失败, 因此只是为Fiber打上Placement标签
      lastPlacedIndex = placeChild(_newFiber, lastPlacedIndex, newIdx);

      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = _newFiber;
      } else {
        // 将新的节点挂载到previousNewFiber.sibling，以为previousNewFiber是resultingFirstChild的一个后继节点
        // 所以最终返回的resultingFirstChild链表包含了newChildren对应的所有Fiber
        previousNewFiber.sibling = _newFiber;
      }

      previousNewFiber = _newFiber;
    }

    if (getIsHydrating()) {
      var _numberOfForks = newIdx;
      pushTreeFork(returnFiber, _numberOfForks);
    }

    return resultingFirstChild;
  }

  // Add all children to a key map for quick lookups.
  // 将剩下的old fibers以key为key，oldFiber为value的形式存储到一个Map中，便于快速查找
  var existingChildren = mapRemainingChildren(returnFiber, oldFiber);

  // Keep scanning and use the map to restore deleted items as moves.
  // 循环遍历剩下的newChildren, 在Map中能找到对应key的Fiber, 则说明顺序发生变化，
  // 会根据type是否相同走Fiber的复用或者新建逻辑, 然后将其在Map中删除, 这样Map
  // 若在newChildren遍历完还剩old fibers, 则说明这些fibers需要删除
  for (; newIdx < newChildren.length; newIdx++) {
    var _newFiber2 = updateFromMap(
      existingChildren,
      returnFiber,
      newIdx,
      newChildren[newIdx],
      lanes
    );

    if (_newFiber2 !== null) {
      if (shouldTrackSideEffects) {
        // 复用成功的节点会从Map中删除,
        if (_newFiber2.alternate !== null) {
          // The new fiber is a work in progress, but if there exists a
          // current, that means that we reused the fiber. We need to delete
          // it from the child list so that we don't add it to the deletion
          // list.
          existingChildren.delete(
            _newFiber2.key === null ? newIdx : _newFiber2.key
          );
        }
      }

      // 复用失败:
      //  为节点打上Placement标签
      //  返回lastPlacedIndex (即lastPlacedIndex不会发生变化)
      // 复用成功:
      //  如果该被复用的Fiber的相对顺序同原相对顺序不一致, 则打上Placement标签, 这里的相对顺序是指该节点
      //  和所有其他节点的前后顺序, 比如节点1、2、3、4, 我们说节点2在节点1的后面, 在节点3、节点4的前面，
      //    假设: 4个节点分别为1234, 其key也分别为1234
      //    例1: 如果更新后顺序为4123, 第一位4默认不算移动, 123原来在4的前面, 现在都跑到4的后面去了,
      //         则认为123都发生了移动, 都会打上Placement标签。
      //    例2: 如果更新后顺序为2314, 第一位2默认不算移动, 3相对2来说是满足原来顺序的,
      //         1相对2和3来说则认为发生了右移, 4相对于231来说都没发生变化。
      //    例3: 如果更新后顺序为2143, 第一位2默认不算移动, 1相对2来说则认为发生了右移, 4相对21来说
      //         没发生变化, 3相对21来说没发生变化, 但是其相对4来说发生了右移。
      // 注意: 复用的Fiber会被打上StaticMask标记
      lastPlacedIndex = placeChild(_newFiber2, lastPlacedIndex, newIdx);

      if (previousNewFiber === null) {
        resultingFirstChild = _newFiber2;
      } else {
        previousNewFiber.sibling = _newFiber2;
      }

      previousNewFiber = _newFiber2;
    }
  }

  // Map中最终剩下的节点表示不在newChildren中, 需要标记Deletion
  if (shouldTrackSideEffects) {
    // Any existing children that weren't consumed above were deleted. We need
    // to add them to the deletion list.
    existingChildren.forEach(function (child) {
      return deleteChild(returnFiber, child);
    });
  }

  if (getIsHydrating()) {
    var _numberOfForks2 = newIdx;
    pushTreeFork(returnFiber, _numberOfForks2);
  }

  return resultingFirstChild;
}
```

`completeUnitOfWork`

```ts
function completeUnitOfWork(unitOfWork) {
  var completedWork = unitOfWork;
  do {
    var current = completedWork.alternate;
    var returnFiber = completedWork.return;
    // 判断completedWork是否含有Incomplete标记
    // 有Incomplete标记, 说明抛出异常了, 会进入异常处理流程 (先忽略)
    if ((completedWork.flags & Incomplete) === NoFlags) {
      next = completeWork(current, completedWork, subtreeRenderLanes);
      if (next !== null) {
        // Completing this fiber spawned new work. Work on that next.
        workInProgress = next;
        return;
      }
    } else {
      // 异常处理
      // TODO: ErrorBoundary在此处捕获异常？
    }

    // 执行到此处说明当前节点还有兄弟节点未执行performUnitOfWork, 所以退出继续执行performUnitOfWork.
    // 如果当前节点是父节点的最后一个子节点, 则在下次循环时如果继续执行到这里, 那么
    // workInProgress变为了returnFiber, 相当于继续处理父节点的兄弟节点.
    // 由此可以看出, performUnitOfWork是按 DFS 顺序处理Fiber节点的.
    var siblingFiber = completedWork.sibling;
    if (siblingFiber !== null) {
      workInProgress = siblingFiber;
      return;
    }

    // Otherwise, return to the parent
    // 执行到此处说明父节点的最后一个子节点已经执行完performUnitOfWork了, 下一步需要完成父节点的completeWork.
    completedWork = returnFiber;
    workInProgress = completedWork;
  } while (completedWork !== null);

  if (workInProgressRootExitStatus === RootInProgress) {
    workInProgressRootExitStatus = RootCompleted;
  }
}
```

可以看出只有叶子节点会执行`completeUnitOfWork`, 非叶子节点是在其最后一个子节点执行完`completeWork`后再回溯(通过 while 实现)执行的`completeWork`

`completeWork`

```ts
function completeWork(current, workInProgress, renderLanes) {
  var newProps = workInProgress.pendingProps;
  // Note: This intentionally doesn't check if we're hydrating because comparing
  // to the current tree provider fiber is just as fast and less error-prone.
  // Ideally we would have a special version of the work loop only
  // for hydration.
  popTreeContext(workInProgress);

  switch (workInProgress.tag) {
    case IndeterminateComponent:
    case LazyComponent:
    case SimpleMemoComponent:
    case FunctionComponent:
    case ForwardRef:
    case Fragment:
    case Mode:
    case Profiler:
    case ContextConsumer:
    case MemoComponent:
      // 计算workInProgress的childLanes和subtreeFlags
      bubbleProperties(workInProgress);
      return null;
    case ClassComponent:
    // 先略过
    case HostRoot:
    // 先略过
    case HostComponent: {
      popHostContext(workInProgress);
      var rootContainerInstance = getRootHostContainer();
      var type = workInProgress.type;

      // update阶段且复用了Fiber
      if (current !== null && workInProgress.stateNode != null) {
        // 内部为执行diffProperties比较新props(nextProps)旧props(lastProps)
        // 新旧props比较算法:
        //  遍历lastProps
        //    1. 忽略存在于nextProps或值为null的属性,
        //    2. 如果key为style, 遍历lastStyle的所有属性并将每个属性的值设置为''然后保存到styleUpdates上, styleUpdates默认为null
        //    3. 如果key为dangerouslySetInnerHTML、children、suppressContentEditableWarning、suppressHydrationWarning、autoFocus则不做处理
        //    4. 如果key为registrationNameDependencies(TODO: 事件相关)中的一个key, 如果updatePayload为空, 将其设置为[]
        //    5. 将key, null为一个pair push到updatePayload
        //    所以遍历结束后, 不存在nextProps的属性会被以key, null pair的形式存放到updatePayload中
        //  遍历nextProps
        //    1. 忽略nextProp === lastProp或nextProp == null && lastProp == null的属性(注意这里比较是用的==, 因此, 当属性在null和undefined之间变换时，不会触发节点更新)
        //    2. 如果key为style, 且存在lastStyle, 遍历lastStyle, 对于存在lastStyle但不存在nextStyle的样式属性执行styleUpdates[styleName] = '', 遍历nextStyle, 对于存在nextStyle但不存在lastStyle的样式属性执行styleUpdates[styleName] = nextProp[styleName];
        //    3. 如果key为style, 且不存在lastStyle, 将style, styleUpdates(此时为null) pair push到updatePayload中并执行styleUpdates = nextStyle
        //    4. 如果key为dangerouslySetInnerHTML, 如果dangerouslySetInnerHTML.__html不为空, 且和last dangerouslySetInnerHTML.__html不想等, 则将dangerouslySetInnerHTML, dangerouslySetInnerHTML.__html pair push到updatePayload中
        //    5. 如果key为children, 并且其值为字符串或数字, 则将children, '' + children pair push到updatePayload中
        //    6. 如果key为suppressContentEditableWarning、suppressHydrationWarning则不做处理
        //    7. 如果key为registrationNameDependencies(TODO: 事件相关)中的一个key, 如果值!= null, 如果类型不是function, 报警告,
        //          如果key为onScroll, 调用listenToNonDelegatedEvent('scroll', domElement)TODO: 为什么要单独处理
        //    8. key为其他值, 将key, value pair push到updatePayload中
        //  如果styleUpdates不为null, 则将style, styleUpdates pair push到updatePayload中
        //  返回updatePayload, updateHostComponent内会判断updatePayload是否为空, 如果不为空则将其挂载到workInProgress.updateQueue上并会给workInProgress.flags打上Update标记
        updateHostComponent(
          current,
          workInProgress,
          type,
          newProps,
          rootContainerInstance
        );

        if (current.ref !== workInProgress.ref) {
          markRef(workInProgress);
        }
      } else {
        // TODO: 为什么newProps为null就只执行bubbleProperties
        if (!newProps) {
          if (workInProgress.stateNode === null) {
            throw new Error(
              "We must have new props for new mounts. This error is likely " +
                "caused by a bug in React. Please file an issue."
            );
          }

          // This can happen when we abort work.
          bubbleProperties(workInProgress);
          return null;
        }

        var currentHostContext = getHostContext();

        // TODO: Move createInstance to beginWork and keep it on a context
        // "stack" as the parent. Then append children as we go in beginWork
        // or completeWork depending on whether we want to add them top->down or
        // bottom->up. Top->down is faster in IE11.
        var _wasHydrated = popHydrationState(workInProgress);

        if (_wasHydrated) {
          // TODO: Move this and createInstance step into the beginPhase
          // to consolidate.
          if (
            prepareToHydrateHostInstance(
              workInProgress,
              rootContainerInstance,
              currentHostContext
            )
          ) {
            // If changes to the hydrated node need to be applied at the
            // commit-phase we mark this as such.
            markUpdate(workInProgress);
          }
        } else {
          // mount阶段, 创建DOM
          var instance = createInstance(
            type,
            newProps,
            rootContainerInstance,
            currentHostContext,
            workInProgress
          );
          // 将所有子DOM节点挂载到instance
          appendAllChildren(instance, workInProgress, false, false);
          workInProgress.stateNode = instance;

          // Certain renderers require commit-time effects for initial mount.
          // (eg DOM renderer supports auto-focus for certain elements).
          // Make sure such renderers get scheduled for later work.
          if (
            finalizeInitialChildren(
              instance,
              type,
              newProps,
              rootContainerInstance
            )
          ) {
            markUpdate(workInProgress);
          }
        }

        if (workInProgress.ref !== null) {
          // If there is a ref on a host node we need to schedule a callback
          markRef(workInProgress);
        }
      }

      bubbleProperties(workInProgress);
      return null;
    }
    case HostText:
    // 先略过
    case SuspenseComponent:
    // 先略过
    case HostPortal:
    // 先略过
    case ContextProvider:
    // 先略过
    case IncompleteClassComponent:
    // 先略过
    case SuspenseListComponent:
    // 先略过
    case ScopeComponent:
    // 先略过
    case OffscreenComponent:
    case LegacyHiddenComponent:
    // 先略过
    case CacheComponent:
    // 先略过
    case TracingMarkerComponent:
    // 先略过
  }
}
```

`bubbleProperties`

```ts
function bubbleProperties(completedWork) {
  // didBailout为true表示completedWork是复用的current Fiber
  var didBailout =
    completedWork.alternate !== null &&
    completedWork.alternate.child === completedWork.child;
  var newChildLanes = NoLanes;
  var subtreeFlags = NoFlags;

  // 未复用
  if (!didBailout) {
    // Bubble up the earliest expiration time.
    // ProfileMode先跳过
    if ((completedWork.mode & ProfileMode) !== NoMode) {
      // In profiling mode, resetChildExpirationTime is also used to reset
      // profiler durations.
      var actualDuration = completedWork.actualDuration;
      var treeBaseDuration = completedWork.selfBaseDuration;
      var child = completedWork.child;

      while (child !== null) {
        newChildLanes = mergeLanes(
          newChildLanes,
          mergeLanes(child.lanes, child.childLanes)
        );
        subtreeFlags |= child.subtreeFlags;
        subtreeFlags |= child.flags;
        // When a fiber is cloned, its actualDuration is reset to 0. This value will
        // only be updated if work is done on the fiber (i.e. it doesn't bailout).
        // When work is done, it should bubble to the parent's actualDuration. If
        // the fiber has not been cloned though, (meaning no work was done), then
        // this value will reflect the amount of time spent working on a previous
        // render. In that case it should not bubble. We determine whether it was
        // cloned by comparing the child pointer.

        actualDuration += child.actualDuration;
        treeBaseDuration += child.treeBaseDuration;
        child = child.sibling;
      }

      completedWork.actualDuration = actualDuration;
      completedWork.treeBaseDuration = treeBaseDuration;
    } else {
      var _child = completedWork.child;

      // 将所有子孙节点的lanes合并, 作为当前节点的childLanes
      // 将所有子孙节点的flags合并, 作为当前节点的subtreeFlags
      while (_child !== null) {
        newChildLanes = mergeLanes(
          newChildLanes,
          mergeLanes(_child.lanes, _child.childLanes)
        );
        subtreeFlags |= _child.subtreeFlags;
        subtreeFlags |= _child.flags;

        // Update the return pointer so the tree is consistent. This is a code
        // smell because it assumes the commit phase is never concurrent with
        // the render phase. Will address during refactor to alternate model.
        _child.return = completedWork;
        _child = _child.sibling;
      }
    }

    completedWork.subtreeFlags |= subtreeFlags;
  } else {
    // Bubble up the earliest expiration time.
    if ((completedWork.mode & ProfileMode) !== NoMode) {
      // In profiling mode, resetChildExpirationTime is also used to reset
      // profiler durations.
      var _treeBaseDuration = completedWork.selfBaseDuration;
      var _child2 = completedWork.child;

      while (_child2 !== null) {
        newChildLanes = mergeLanes(
          newChildLanes,
          mergeLanes(_child2.lanes, _child2.childLanes)
        );
        // "Static" flags share the lifetime of the fiber/hook they belong to,
        // so we should bubble those up even during a bailout. All the other
        // flags have a lifetime only of a single render + commit, so we should
        // ignore them.
        subtreeFlags |= _child2.subtreeFlags & StaticMask; // 和未复用相比多了StaticMask
        subtreeFlags |= _child2.flags & StaticMask; // 和未复用相比多了StaticMask
        _treeBaseDuration += _child2.treeBaseDuration;
        _child2 = _child2.sibling;
      }

      completedWork.treeBaseDuration = _treeBaseDuration;
    } else {
      var _child3 = completedWork.child;

      while (_child3 !== null) {
        newChildLanes = mergeLanes(
          newChildLanes,
          mergeLanes(_child3.lanes, _child3.childLanes)
        );
        // "Static" flags share the lifetime of the fiber/hook they belong to,
        // so we should bubble those up even during a bailout. All the other
        // flags have a lifetime only of a single render + commit, so we should
        // ignore them.

        subtreeFlags |= _child3.subtreeFlags & StaticMask;
        subtreeFlags |= _child3.flags & StaticMask;

        // Update the return pointer so the tree is consistent. This is a code
        // smell because it assumes the commit phase is never concurrent with
        // the render phase. Will address during refactor to alternate model.
        _child3.return = completedWork;
        _child3 = _child3.sibling;
      }
    }

    completedWork.subtreeFlags |= subtreeFlags;
  }

  completedWork.childLanes = newChildLanes;
  return didBailout;
}
```

小结:

1. 异步任务开始执行
2. 初次渲染`lanes`为`DefaultLane`, 所以会走`renderRootSync`
3. `renderRootSync`执行的是`workLoopSync`, `workLoopSync`会对`workInProgress Fiber`(初始为 root.current)执行`performUnitOfWork`, 直到`workInProgress`为`null`, 并且这个过程不可中断
4. `performUnitOfWork`
   `beginWork`
   `beginWork`是一个 DFS 过程

   1. 通过一系列判断设置全局变量`didReceiveUpdate`的值, 这个只用来标识当前`Fiber`是否需要更新, 后续操作可以通过判断`didReceiveUpdate`的值做优化处理
   2. 调用`cloneUpdateQueue`, 将`current.updateQueue`copy 到`workInProgress.updateQueue`
   3. 调用`processUpdateQueue`, 生成最新的`updateQueue.memoizedState`、`updateQueue.baseState`、`updateQueue.effects`(不为空还会给节点打上`Callback`标记)、`workInProgress.lanes`
   4. 通过第 3 步生成的`updateQueue.memoizedState.element`(TODO: 为什么不是取 baseState.element?)拿到`nextChildren`, 然后调用`reconcileChildren`为`workInProgress`生成`child`
   5. `reconcileChildren`里面通过`current`是否为空判断当前是`mount`阶段还是`update`阶段, 如果是`mount`阶段, 则为`workInProgress.child`创建新`Fiber`, 如果是`update`阶段, 则会根据`diff算法`决定为`workInProgress.child`复用`旧Fiber`还是创建`新Fiber`
      `diff算法`分为`单节点diff`和`多节点diff`

   `completeUnitOfWork`

   `completeUnitOfWork`是一个回溯过程

   1. 为当前节点执行`completeWork`
      `mount`阶段`HostComponent`会创建 DOM, 并插入子节点
      `update`阶段`HostComponent`会`diff properties`, 如果发现属性变更, 会为节点打上`Update`标签（优化操作: 如果 oldProps === newProps 直接跳过 diff）
      执行`bubbleProperties`将所有子节点的`flags`和`subtreeFlags`归并到当前节点的`subtreeFlags`, 将所有子节点的`lanes`和`childLanes`归并到`childLanes`上面
   2. 判断当前节点是否还有兄弟节点, 如果有则将`workInProgress`设置为当前节点的兄弟节点, 跳出当前函数
   3. 如果没有兄弟节点, 将当前节点设为`returnFiber`再执行第一步


