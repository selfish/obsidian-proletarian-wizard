import * as React from "react";
import { TodoItem, TodoStatus, getTodoId } from "../domain/TodoItem"
import { App, Menu, TFile } from "obsidian";
import { FileOperations } from "src/domain/FileOperations";
import { ILogger } from "src/domain/ILogger";
import { ProletarianWizardSettings } from "src/domain/ProletarianWizardSettings";

function statusToIcon(status: TodoStatus): string {
  switch (status) {
    case TodoStatus.Complete:
      return "✔";
    case TodoStatus.AttentionRequired:
      return "❗";
    case TodoStatus.Canceled:
      return "❌";
    case TodoStatus.Delegated:
      return "👬";
    case TodoStatus.InProgress:
      return "‍⏩";
    case TodoStatus.Todo:
      return "⚪️";
    default:
      return "";
  }
};

export interface TodoSatusComponentDeps {
  logger: ILogger,
  app: App,
}

export interface TodoSatusComponentProps {
  todo: TodoItem<TFile>,
  deps: TodoSatusComponentDeps,
  settings: ProletarianWizardSettings,
}

export function TodoStatusComponent({todo, deps, settings,}: TodoSatusComponentProps) {
  
  const addChangeStatusMenuItem = (menu: Menu, status: TodoStatus, label: string) => {
    menu.addItem((item) => {
      item.setTitle(label)
      item.onClick(() => {
        todo.status = status
        FileOperations.updateTodoStatus(todo, settings.completedDateAttribute)
      })
    })
  }

  const onauxclick = (evt: any) => {
    if (evt.defaultPrevented) {
      return
    }
    const menu = new Menu(deps.app)
    addChangeStatusMenuItem(menu, TodoStatus.Todo, "◻️ Mark as todo")
    addChangeStatusMenuItem(menu, TodoStatus.Complete, "✔️ Mark as complete")
    addChangeStatusMenuItem(menu, TodoStatus.InProgress, "⏩ Mark as in progress")
    addChangeStatusMenuItem(menu, TodoStatus.AttentionRequired, "❗ Mark as attention required")
    addChangeStatusMenuItem(menu, TodoStatus.Delegated, "👬 Mark as delegated")
    addChangeStatusMenuItem(menu, TodoStatus.Canceled, "❌ Mark as cancelled")
    menu.showAtMouseEvent(evt)
    evt.preventDefault();
  }

  const onclick = (evt: any) => {
    if (evt.defaultPrevented) {
      return
    }
    deps.logger.debug(`Changing status on ${getTodoId(todo)}`);
    evt.preventDefault();
    const wasCompleted = todo.status === TodoStatus.Complete || todo.status === TodoStatus.Canceled
		todo.status = wasCompleted ? TodoStatus.Todo : TodoStatus.Complete
		FileOperations.updateTodoStatus(todo, settings.completedDateAttribute)
  }

  return <div className="pw-todo-checkbox" onClick={onclick} onAuxClick={onauxclick}>
    {statusToIcon(todo.status)}
  </div>;
}