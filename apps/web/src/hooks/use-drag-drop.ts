import { useCallback, useState } from "react";
import type { DropZoneType } from "@/components/transaction-widget/DropZone";
import type { TokenBalance } from "@/hooks/use-wallet-balances";

type DragDropState = {
  // Drag state
  isDragging: boolean;
  draggedToken: TokenBalance | null;

  // Tap-to-select state (mobile)
  selectedToken: TokenBalance | null;

  // Drop zone states
  dragOverZone: DropZoneType | null;

  // Expanded form state
  expandedZone: DropZoneType | null;
  droppedToken: TokenBalance | null;

  // Transaction state
  transactionStatus: "pending" | "success" | "error" | null;
  transactionResult: { signature?: string; error?: string } | null;
  isExecuting: boolean;
};

const initialState: DragDropState = {
  isDragging: false,
  draggedToken: null,
  selectedToken: null,
  dragOverZone: null,
  expandedZone: null,
  droppedToken: null,
  transactionStatus: null,
  transactionResult: null,
  isExecuting: false,
};

export function useDragDrop() {
  const [state, setState] = useState<DragDropState>(initialState);

  // Start dragging a token
  const startDrag = useCallback((token: TokenBalance) => {
    setState((prev) => ({
      ...prev,
      isDragging: true,
      draggedToken: token,
    }));
  }, []);

  // End dragging (without dropping)
  const endDrag = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isDragging: false,
      draggedToken: null,
      dragOverZone: null,
    }));
  }, []);

  // Drag over a drop zone
  const dragOverZone = useCallback((zone: DropZoneType) => {
    setState((prev) => ({
      ...prev,
      dragOverZone: zone,
    }));
  }, []);

  // Leave a drop zone
  const dragLeaveZone = useCallback(() => {
    setState((prev) => ({
      ...prev,
      dragOverZone: null,
    }));
  }, []);

  // Drop on a zone - expand the form
  const dropOnZone = useCallback((zone: DropZoneType, token: TokenBalance) => {
    setState((prev) => ({
      ...prev,
      isDragging: false,
      draggedToken: null,
      selectedToken: null,
      dragOverZone: null,
      expandedZone: zone,
      droppedToken: token,
      // Reset transaction state when opening a new form
      transactionStatus: null,
      transactionResult: null,
      isExecuting: false,
    }));
  }, []);

  // Select a token via tap (mobile)
  const selectToken = useCallback((token: TokenBalance) => {
    setState((prev) => ({
      ...prev,
      selectedToken: prev.selectedToken?.mint === token.mint ? null : token,
    }));
  }, []);

  // Deselect token
  const deselectToken = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectedToken: null,
    }));
  }, []);

  // Cancel the expanded form
  const cancelForm = useCallback(() => {
    setState((prev) => ({
      ...prev,
      expandedZone: null,
      droppedToken: null,
      transactionStatus: null,
      transactionResult: null,
      isExecuting: false,
    }));
  }, []);

  // Set transaction executing
  const setExecuting = useCallback((executing: boolean) => {
    setState((prev) => ({
      ...prev,
      isExecuting: executing,
    }));
  }, []);

  // Set transaction result
  const setTransactionResult = useCallback(
    (
      status: "success" | "error",
      result: { signature?: string; error?: string }
    ) => {
      setState((prev) => ({
        ...prev,
        isExecuting: false,
        transactionStatus: status,
        transactionResult: result,
      }));
    },
    []
  );

  // Reset everything
  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    state,
    startDrag,
    endDrag,
    selectToken,
    deselectToken,
    dragOverZone,
    dragLeaveZone,
    dropOnZone,
    cancelForm,
    setExecuting,
    setTransactionResult,
    reset,
  };
}
