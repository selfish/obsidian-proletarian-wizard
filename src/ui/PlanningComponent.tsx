import * as React from "react";
import { createRoot } from "react-dom/client";

import { TodoItem, TodoStatus, getTodoId } from "../domain/TodoItem";
import { ILogger } from "../domain/ILogger";
import { App, TFile} from "obsidian";
import { DateTime } from "luxon";
import { TodoIndex } from "../domain/TodoIndex";
import { FileOperations } from "../domain/FileOperations";
import { ProletarianWizardSettings } from "../domain/ProletarianWizardSettings";
import { PlanningSettingsComponent } from "./PlanningSettingsComponent";
import { PlanningTodoColumn } from "./PlanningTodoColumn";
import { TodoMatcher } from "src/domain/TodoMatcher";
import { PlanningSettingsStore } from "./PlanningSettingsStore";
import { Sound, SoundPlayer } from "./SoundPlayer";
import { PwEvent } from "src/events/PwEvent";

function findTodoDate<T>(todo: TodoItem<T>, attribute: string): DateTime | null {
  if (!todo.attributes) {
    return null
  }
  const attr = todo.attributes[attribute]
  if (attr) {
    const d = DateTime.fromISO(`${todo.attributes[attribute]}`);
    return d.isValid ? d : null
  }
  return null;
}

export interface PlanningComponentDeps {
  logger: ILogger,
  todoIndex: TodoIndex<TFile>,
}

export interface PlanningComponentProps {
  deps: PlanningComponentDeps,
  settings: ProletarianWizardSettings,
  app: App,
}

export function PlanningComponent({deps, settings, app}: PlanningComponentProps) {
  const savedSettings = React.useMemo(() => PlanningSettingsStore.getSettings(), []);
  const [planningSettings, setPlanningSettingsState] = React.useState(savedSettings);
  const [todos, setTodos] = React.useState<TodoItem<TFile>[]>(deps.todoIndex.todos);
  const setPlanningSettings = PlanningSettingsStore.decorateSetterWithSaveSettings(setPlanningSettingsState);
  const { searchParameters, hideEmpty, wipLimit } = planningSettings;
	const fileOperations = new FileOperations(settings);

  const playSound = React.useMemo(() => new PwEvent<Sound>(), []);

  const filteredTodos = React.useMemo(() => {
    const filter = new TodoMatcher(searchParameters.searchPhrase, searchParameters.fuzzySearch);
    return todos.filter(filter.matches);
  }, [todos, searchParameters]);

  React.useEffect(() => {
    deps.todoIndex.onUpdateEvent.listen(async (todos) => {
      setTodos(todos);
    })
  }, [deps.todoIndex]);

  function getTodosByDate(from: DateTime | null, to: DateTime | null, includeSelected: boolean = false): TodoItem<TFile>[] {
    const dateIsInRange = (date: DateTime | null) => date && (from === null || date >= from) && (to === null || date < to)
    function todoInRange<T>(todo: TodoItem<T>){
      const isDone = todo.status === TodoStatus.Complete || todo.status === TodoStatus.Canceled
      const isSelected = todo.attributes && !!todo.attributes[settings.selectedAttribute]
      const dueDate = findTodoDate(todo, settings.dueDateAttribute)
      const completedDate = findTodoDate(todo, settings.completedDateAttribute)
      const dueDateIsInRange = dateIsInRange(dueDate)
      const completedDateIsInRange = dateIsInRange(completedDate)
      const isInRangeOrSelected = dueDateIsInRange || (includeSelected && isSelected && (isDone && completedDateIsInRange || !isDone))
      return isInRangeOrSelected
    }
    const todosInRange = filteredTodos.filter((todo) => todo.attributes && todoInRange(todo));
    return todosInRange
  }

  function getTodosWithNoDate<T>(): TodoItem<TFile>[] {
    return filteredTodos.filter(todo =>
      !findTodoDate(todo, settings.dueDateAttribute)
      && todo.attributes
      && !todo.attributes[settings.selectedAttribute]
      && todo.status !== TodoStatus.Canceled && todo.status !== TodoStatus.Complete)
  }

  function findTodo(todoId: string): TodoItem<TFile> | undefined {
		return todos.find(todo => getTodoId(todo) === todoId);
  }

  function moveToDate(date: DateTime) {
    return (todoId: string) => {
      const todo = findTodo(todoId);
      deps.logger.debug(`Moving ${todoId} to ${date}`);
      if (!todo) {
        deps.logger.warn(`Todo ${todoId} not found, couldn't move`);
        return;
      }
			fileOperations.updateAttributeAsync(todo, settings.dueDateAttribute, date.toISODate()).then()
    }
  }

  function removeDate() {
    return (todoId: string) => {
      const todo = findTodo(todoId);
      if (!todo) {
        return;
      }
			fileOperations.removeAttributeAsync(todo, settings.dueDateAttribute).then()
    }
  }

  function moveToDateAndStatus(date: DateTime, status: TodoStatus) {
    return (todoId: string) => {
      const todo = findTodo(todoId);
      deps.logger.debug(`Moving ${todoId} to ${date}`);
      if (!todo) {
        deps.logger.warn(`Todo ${todoId} not found, couldn't move`);
        return;
      }
      todo.status = status;

      fileOperations.updateAttributeAsync(todo, settings.dueDateAttribute, date.toISODate())
        .then(() => fileOperations.updateTodoStatus(todo, settings.completedDateAttribute))
        .then(() => {
          if (settings.trackStartTime && !todo.attributes[settings.startedAttribute] && status === TodoStatus.InProgress) {
            return fileOperations.updateAttributeAsync(todo, settings.startedAttribute, DateTime.now().toISODate())
          }
        });
    }
  }

  function getTodosByDateAndStatus(from: DateTime, to: DateTime, status: TodoStatus[]) {
    const todos = getTodosByDate(from, to, true);
    return todos.filter(todo => status.contains(todo.status));
  }

  function todoColumn(
    icon: string,
    title: string,
    todos: TodoItem<TFile>[],
    hideIfEmpty = hideEmpty,
    onTodoDropped: ((todoId: string) => void) | null = null,
    substyle?: string) {
    return <PlanningTodoColumn 
      hideIfEmpty={hideIfEmpty}
      planningSettings={planningSettings}
      icon={icon}
      title={title}
      key={title}
      onTodoDropped={onTodoDropped}
      todos={todos}
      playSound={playSound}      
      deps={{
        app, settings, logger: deps.logger,
      }}
      substyle={substyle}
    />;
  }

  function getTodayWipStyle() {
    if (!wipLimit.isLimited) {
      return ""
    }
    const today = DateTime.now().startOf("day")
    const tomorrow = today.plus({ day: 1 });
    const todos = getTodosByDateAndStatus(today, tomorrow, [TodoStatus.AttentionRequired, TodoStatus.Delegated, TodoStatus.InProgress, TodoStatus.Todo]);
    if (todos.length > wipLimit.dailyLimit) {
      return "pw-planning-column-content--wip-exceeded"
    }
  }

  function* getTodayColumns() {
    const today = DateTime.now().startOf("day")
    const tomorrow = today.plus({ day: 1 });

    yield todoColumn(
      "◻️",
      "Todo",
      getTodosByDateAndStatus(today, tomorrow, [TodoStatus.Todo]),
      false,
      moveToDateAndStatus(today, TodoStatus.Todo),
      "today");
      
    yield todoColumn(
      "⏩",
      "In progress",
      getTodosByDateAndStatus(today, tomorrow, [TodoStatus.AttentionRequired, TodoStatus.Delegated, TodoStatus.InProgress]),
      false,
      moveToDateAndStatus(today, TodoStatus.InProgress),
      "today");

    yield todoColumn(
      "✅",
      "Done",
      getTodosByDateAndStatus(today, tomorrow, [TodoStatus.Canceled, TodoStatus.Complete]),
      false,
      moveToDateAndStatus(today, TodoStatus.Complete),
      "today");
  }

  function getWipStyle(todos: TodoItem<TFile>[]) {
    if (wipLimit.isLimited) {
      if (todos.length > wipLimit.dailyLimit) {
        return "wip-exceeded";
      }
    }
    return "";
  }

  function* getColumns() {
    yield todoColumn(
      "📃",
      "Backlog",
      getTodosWithNoDate(),
      false,
      removeDate());

    const today = DateTime.now().startOf("day")
                yield todoColumn(
      "🕸️",
      "Past",
      getTodosByDate(null, today).filter(
        todo => todo.status !== TodoStatus.Canceled && todo.status !== TodoStatus.Complete),
      true);

    const firstWeekday = settings.firstWeekday ?? 1

    // Daily brackets
    let dayStart = today.plus({ day: 1 })
    for (let i = 0; i < 6; i++) {
      const dayEnd = dayStart.plus({ day: 1 })
      const localDay = ((dayStart.weekday - firstWeekday + 7) % 7) + 1
      if (!settings.showWeekEnds && localDay >= 6) {
        dayStart = dayEnd
        continue
      }
      const label = i === 0 ? "Tomorrow" : dayStart.toFormat("cccc dd/MM")
      const todos = getTodosByDate(dayStart, dayEnd)
      const style = getWipStyle(todos)
      yield todoColumn(
        "📅",
        label,
        todos,
        hideEmpty,
        moveToDate(dayStart),
        style)
      dayStart = dayEnd
    }

    // Weekly brackets starting on the first weekday
    let startOfThisWeek = today.set({ weekday: firstWeekday })
    if (startOfThisWeek > today) {
      startOfThisWeek = startOfThisWeek.minus({ weeks: 1 })
    }
    let weekStart = startOfThisWeek.plus({ weeks: 1 })
    for (let i = 0; i < 4; i++) {
      const weekEnd = weekStart.plus({ weeks: 1 })
      const label = i === 0
        ? "Next week"
        : `Week +${i + 1} (${weekStart.toFormat("dd/MM")} - ${weekEnd.minus({ days: 1 }).toFormat("dd/MM")})`
      const todos = getTodosByDate(weekStart, weekEnd)
      const style = getWipStyle(todos)
      yield todoColumn(
        "📅",
        label,
        todos,
        hideEmpty,
        moveToDate(weekStart),
        style)
      weekStart = weekEnd
    }

    // Monthly brackets starting on the first day of each month
    let monthStart = today.startOf("month").plus({ months: 1 })
    for (let i = 0; i < 3; i++) {
      const monthEnd = monthStart.plus({ months: 1 })
      const label = i === 0
        ? "Next month"
        : `Month +${i + 1} (${monthStart.toFormat("dd/MM")} - ${monthEnd.minus({ days: 1 }).toFormat("dd/MM")})`
      const todos = getTodosByDate(monthStart, monthEnd)
      const style = getWipStyle(todos)
      yield todoColumn(
        "📅",
        label,
        todos,
        hideEmpty,
        moveToDate(monthStart),
        style)
      monthStart = monthEnd
    }

    yield todoColumn(
      "📅",
      "Later",
      getTodosByDate(monthStart, null),
      hideEmpty,
      moveToDate(monthStart));
  }

  deps.logger.debug(`Rendering planning view`)

  return <>
    <div className={`pw-planning-today ${getTodayWipStyle()}`}>
      <h1><span className="pw-planning-today-icon">☀️</span> Today</h1>
      {Array.from(getTodayColumns())}
    </div>
    <div className="pw-planning-columns">
      {Array.from(getColumns())}
    </div>
    <PlanningSettingsComponent
      planningSettings={planningSettings}
      setPlanningSettings={setPlanningSettings}
      />
    <SoundPlayer deps={deps} playSound={playSound}></SoundPlayer>
  </>;
}

export function MountPlanningComponent(onElement: HTMLElement, props: PlanningComponentProps) {
  const client = createRoot(onElement);
  client.render(<PlanningComponent {...props}></PlanningComponent>);
}