Feature: Keep active work visible

  Scenario: Agent updates a task plan while I keep working
    Given an agent has a two-task "Research" plan
    When it starts and completes tasks with the todo tool
    Then one "Tasks" widget stays above the editor and shows the current remaining work
    And each todo tool call leaves only a compact status row in the transcript

  Scenario: Resume work with remaining tasks
    Given a saved session has an unfinished "Verify" task
    When I resume that session or navigate back to its branch
    Then the "Tasks" widget above the editor shows the unfinished task

  Scenario: Finish the plan
    Given the "Tasks" widget shows the only remaining task
    When the agent completes that task
    Then the widget clears and the editor regains the space
