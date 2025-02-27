import { array, number } from 'io-ts';
import React, {
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react';

import css from 'components/ActionDropdown/ActionDropdown.module.scss';
import Button from 'components/kit/Button';
import Dropdown from 'components/kit/Dropdown';
import Icon from 'components/kit/Icon';
import TableBatch from 'components/Table/TableBulkActions';
import usePrevious from 'hooks/usePrevious';
import { SettingsConfig, useSettings } from 'hooks/useSettings';
import { isEqual } from 'utils/data';
import { noOp } from 'utils/service';

import { encodeIdList } from '../api';
import { TrialsCollectionSpec, TrialsSelection } from '../Collections/collections';
import { TrialFilters, TrialSorter } from '../Collections/filters';
import { CollectionModalProps } from '../Collections/useModalCreateCollection';

import useModalTrialTag from './useModalTagTrials';
import {
  dispatchTrialAction,
  openTensorBoard,
  TrialAction,
  trialActionDefs,
  TrialsActionHandler,
} from './utils';
export interface TrialActionsInterface {
  TrialActionDropdown: React.FC<{ children?: ReactNode; id: number }>;
  dispatcher: ReactNode;
  modalContextHolder: React.ReactElement;
  selectAllMatching: boolean;
  selectTrials: (ids: unknown) => void;
  selectedTrials: number[];
  setSelectedTrials: Dispatch<SetStateAction<number[]>>;
}

interface Props {
  availableIds: number[];
  filters: TrialFilters;
  openCreateModal: (p: CollectionModalProps) => void;

  refetch: () => void;
  sorter: TrialSorter;
  workspaceId: number;
}

export const settingsConfig: SettingsConfig<{ ids: number[] }> = {
  settings: {
    ids: {
      defaultValue: [],
      // skipUrlEncoding: true,
      storageKey: 'selectedTrialIds',
      type: array(number),
    },
  },
  storagePath: 'trials-selection',
};

const useTrialActions = ({
  availableIds,
  filters,
  sorter,
  openCreateModal,
  refetch,
  workspaceId,
}: Props): TrialActionsInterface => {
  const { settings, updateSettings } = useSettings<{ ids: number[] }>(settingsConfig);

  const [selectedTrials, setSelectedTrials] = useState<number[]>(settings.ids ?? []);

  const previouslySelectedTrials = usePrevious(selectedTrials, undefined);

  useEffect(() => {
    if (previouslySelectedTrials && !isEqual(previouslySelectedTrials, selectedTrials)) {
      updateSettings({ ids: selectedTrials });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrials, previouslySelectedTrials]);

  const previouslyAvailableIds = usePrevious(availableIds, undefined);

  useEffect(() => {
    if (previouslyAvailableIds && !isEqual(previouslyAvailableIds, availableIds))
      setSelectedTrials((ids) => ids.filter((id) => availableIds.includes(id)));
  }, [availableIds, previouslyAvailableIds]);

  const [selectAllMatching, setSelectAllMatching] = useState<boolean>(false);
  const handleChangeSelectionMode = useCallback(() => setSelectAllMatching((prev) => !prev), []);

  const selectTrials = useCallback(
    (rowKeys: unknown) => setSelectedTrials(encodeIdList(rowKeys as string[]) ?? []),
    [setSelectedTrials],
  );

  const clearSelected = useCallback(() => {
    setSelectedTrials([]);
  }, [setSelectedTrials]);

  const { contextHolder, modalOpen } = useModalTrialTag({ onConfirm: refetch });

  const handleBatchAction = useCallback(
    async (action: string) => {
      const trials = selectAllMatching
        ? ({ filters, sorter } as TrialsCollectionSpec)
        : ({ sorter: sorter, trialIds: selectedTrials } as TrialsSelection);

      const handle = async (handler: TrialsActionHandler) =>
        await dispatchTrialAction(action as TrialAction, trials, handler, workspaceId);

      await (action === TrialAction.AddTags
        ? handle(modalOpen)
        : action === TrialAction.TagAndCollect
        ? handle(openCreateModal)
        : action === TrialAction.OpenTensorBoard
        ? handle(openTensorBoard)
        : Promise.resolve());
    },
    [selectedTrials, modalOpen, selectAllMatching, sorter, filters, openCreateModal, workspaceId],
  );

  const dispatcher = (
    <TableBatch
      actions={Object.values(trialActionDefs)}
      selectAllMatching={selectAllMatching}
      selectedRowCount={selectedTrials.length}
      onAction={handleBatchAction}
      onChangeSelectionMode={handleChangeSelectionMode}
      onClear={clearSelected}
    />
  );

  const TrialActionDropdown: React.FC<{ children?: ReactNode; id: number }> = ({
    id,
    children,
  }) => {
    const menu = [
      { key: TrialAction.OpenTensorBoard, label: 'Open in Tensorboard' },
      { key: TrialAction.AddTags, label: 'Add Tags' },
    ];

    const handleDropdown = (key: string) => {
      dispatchTrialAction(
        key as TrialAction,
        { trialIds: [id] },
        key === TrialAction.OpenTensorBoard
          ? openTensorBoard
          : key === TrialAction.AddTags
          ? modalOpen
          : noOp,
        workspaceId,
      );
    };

    return children ? (
      <>
        <Dropdown menu={menu} onClick={handleDropdown}>
          {children}
        </Dropdown>
      </>
    ) : (
      <div className={css.base} title="Open actions menu" onClick={(e) => e.stopPropagation()}>
        <Dropdown menu={menu} placement="bottomRight" onClick={handleDropdown}>
          <Button type="text" onClick={(e) => e.stopPropagation()}>
            <Icon name="overflow-vertical" title="Action menu" />
          </Button>
        </Dropdown>
      </div>
    );
  };

  return {
    dispatcher,
    modalContextHolder: contextHolder,
    selectAllMatching,
    selectedTrials,
    selectTrials,
    setSelectedTrials,
    TrialActionDropdown,
  };
};
export default useTrialActions;
