/**
 * Built-in example workflow pair for the "Load example" button.
 *
 * Covers SIMPLE, HTTP, SWITCH (decisionCases + defaultCase), FORK_JOIN +
 * JOIN, DO_WHILE and SUB_WORKFLOW. The After version:
 *   - adds a task   (fraud_check, after validate_order)
 *   - removes a task (notify_delay, from the backorder branch)
 *   - changes inputParameters of another (fetch_customer HTTP uri + header)
 */

import type { WorkflowDefinition, WorkflowTask } from "./lib/workflowGraph";

function baseTasks(): WorkflowTask[] {
  return [
    {
      name: "validate_order",
      taskReferenceName: "validate_order_ref",
      type: "SIMPLE",
      inputParameters: {
        orderId: "${workflow.input.orderId}",
      },
    },
    {
      name: "fetch_customer",
      taskReferenceName: "fetch_customer_ref",
      type: "HTTP",
      inputParameters: {
        http_request: {
          uri: "https://api.example.com/v1/customers/${workflow.input.customerId}",
          method: "GET",
          headers: { Accept: "application/json" },
        },
      },
    },
    {
      name: "check_inventory",
      taskReferenceName: "check_inventory_ref",
      type: "SWITCH",
      evaluatorType: "value-param",
      expression: "stockStatus",
      inputParameters: {
        stockStatus: "${validate_order_ref.output.stockStatus}",
      },
      decisionCases: {
        in_stock: [
          {
            name: "reserve_items",
            taskReferenceName: "reserve_items_ref",
            type: "SIMPLE",
            inputParameters: {
              orderId: "${workflow.input.orderId}",
            },
          },
        ],
        backorder: [
          {
            name: "create_backorder",
            taskReferenceName: "create_backorder_ref",
            type: "SIMPLE",
            inputParameters: {
              orderId: "${workflow.input.orderId}",
            },
          },
          {
            name: "notify_delay",
            taskReferenceName: "notify_delay_ref",
            type: "SIMPLE",
            inputParameters: {
              channel: "email",
              template: "backorder_delay",
            },
          },
        ],
      },
      defaultCase: [
        {
          name: "manual_review",
          taskReferenceName: "manual_review_ref",
          type: "SIMPLE",
          inputParameters: {
            queue: "ops_review",
          },
        },
      ],
    },
    {
      name: "fork_notifications",
      taskReferenceName: "fork_notifications_ref",
      type: "FORK_JOIN",
      forkTasks: [
        [
          {
            name: "send_email",
            taskReferenceName: "send_email_ref",
            type: "SIMPLE",
            inputParameters: { template: "order_update" },
          },
        ],
        [
          {
            name: "send_sms",
            taskReferenceName: "send_sms_ref",
            type: "SIMPLE",
            inputParameters: { template: "order_update_sms" },
          },
        ],
      ],
    },
    {
      name: "join_notifications",
      taskReferenceName: "join_notifications_ref",
      type: "JOIN",
      joinOn: ["send_email_ref", "send_sms_ref"],
    },
    {
      name: "retry_charge",
      taskReferenceName: "retry_charge_ref",
      type: "DO_WHILE",
      loopCondition:
        "if ($.retry_charge_ref['iteration'] < 3 && $.verify_charge_ref['status'] != 'CHARGED') { true; } else { false; }",
      loopOver: [
        {
          name: "charge_payment",
          taskReferenceName: "charge_payment_ref",
          type: "HTTP",
          inputParameters: {
            http_request: {
              uri: "https://payments.example.com/v1/charge",
              method: "POST",
              body: {
                orderId: "${workflow.input.orderId}",
                amount: "${validate_order_ref.output.total}",
              },
            },
          },
        },
        {
          name: "verify_charge",
          taskReferenceName: "verify_charge_ref",
          type: "SIMPLE",
          inputParameters: {
            chargeId: "${charge_payment_ref.output.response.body.chargeId}",
          },
        },
      ],
    },
    {
      name: "fulfill_order",
      taskReferenceName: "fulfill_order_ref",
      type: "SUB_WORKFLOW",
      subWorkflowParam: {
        name: "order_fulfillment_shipping",
        version: 2,
      },
      inputParameters: {
        orderId: "${workflow.input.orderId}",
      },
    },
    {
      name: "complete_order",
      taskReferenceName: "complete_order_ref",
      type: "SIMPLE",
      inputParameters: {
        orderId: "${workflow.input.orderId}",
        status: "COMPLETED",
      },
    },
  ];
}

const beforeDefinition: WorkflowDefinition = {
  name: "order_processing",
  description: "Process an e-commerce order end to end",
  version: 1,
  schemaVersion: 2,
  ownerEmail: "platform@example.com",
  timeoutSeconds: 3600,
  tasks: baseTasks(),
};

function afterTasks(): WorkflowTask[] {
  const tasks = baseTasks();

  // Added task: fraud_check right after validate_order.
  tasks.splice(1, 0, {
    name: "fraud_check",
    taskReferenceName: "fraud_check_ref",
    type: "SIMPLE",
    inputParameters: {
      orderId: "${workflow.input.orderId}",
      customerId: "${workflow.input.customerId}",
    },
  });

  // Changed task: fetch_customer now hits v2 and sends an auth header.
  const fetchCustomer = tasks.find(
    t => t.taskReferenceName === "fetch_customer_ref",
  )!;
  fetchCustomer.inputParameters = {
    http_request: {
      uri: "https://api.example.com/v2/customers/${workflow.input.customerId}",
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer ${workflow.secrets.api_token}",
      },
    },
  };

  // Removed task: notify_delay disappears from the backorder branch.
  const switchTask = tasks.find(
    t => t.taskReferenceName === "check_inventory_ref",
  )!;
  switchTask.decisionCases!.backorder = switchTask.decisionCases!.backorder!.filter(
    t => t.taskReferenceName !== "notify_delay_ref",
  );

  return tasks;
}

const afterDefinition: WorkflowDefinition = {
  ...beforeDefinition,
  version: 2,
  tasks: afterTasks(),
};

export const EXAMPLE_BEFORE = JSON.stringify(beforeDefinition, null, 2);
export const EXAMPLE_AFTER = JSON.stringify(afterDefinition, null, 2);
