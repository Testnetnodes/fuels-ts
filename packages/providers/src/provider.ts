import { arrayify, hexlify } from '@ethersproject/bytes';
import type { Receipt, Transaction } from '@fuel-ts/transactions';
import { ReceiptCoder, TransactionCoder } from '@fuel-ts/transactions';

import type {
  BlockFragmentFragment,
  DryRunMutation,
  DryRunMutationVariables,
  EndSessionMutation,
  EndSessionMutationVariables,
  ExecuteMutation,
  ExecuteMutationVariables,
  GetBlockQuery,
  GetBlockQueryVariables,
  GetBlocksQuery,
  GetBlocksQueryVariables,
  GetCoinQuery,
  GetCoinQueryVariables,
  GetTransactionQuery,
  GetTransactionQueryVariables,
  GetTransactionsQuery,
  GetTransactionsQueryVariables,
  GetVersionQuery,
  GetVersionQueryVariables,
  ResetMutation,
  ResetMutationVariables,
  StartSessionMutation,
  StartSessionMutationVariables,
  SubmitMutation,
  SubmitMutationVariables,
} from './operations.types';
import type { TransactionRequest } from './transaction-request';
import { transactionFromRequest } from './transaction-request';
import gql from './utils/gql';
import graphqlFetch from './utils/graphqlFetch';

export type TransactionResponse = {
  receipts: Receipt[];
};

const blockFragment = gql`
  fragment blockFragment on Block {
    id
    height
    producer
    transactions {
      id
      rawPayload
    }
    time
  }
`;

export default class Provider {
  constructor(public url: string) {}

  async getVersion(): Promise<string> {
    const { version } = await graphqlFetch<GetVersionQuery, GetVersionQueryVariables>(
      this.url,
      gql`
        query {
          version
        }
      `
    );

    return version;
  }

  async getTransaction(transactionId: string): Promise<Transaction | void> {
    const { transaction } = await graphqlFetch<GetTransactionQuery, GetTransactionQueryVariables>(
      this.url,
      gql`
        query getTransaction($transactionId: HexString256!) {
          transaction(id: $transactionId) {
            id
            rawPayload
          }
        }
      `,
      { transactionId }
    );

    if (!transaction) {
      return undefined;
    }

    return new TransactionCoder('transaction').decode(arrayify(transaction.rawPayload), 0)[0];
  }

  async getTransactions(variables: GetTransactionsQueryVariables): Promise<Transaction[]> {
    const { transactions } = await graphqlFetch<
      GetTransactionsQuery,
      GetTransactionsQueryVariables
    >(
      this.url,
      gql`
        query getTransactions($after: String, $before: String, $first: Int, $last: Int) {
          transactions(after: $after, before: $before, first: $first, last: $last) {
            edges {
              node {
                id
                rawPayload
              }
            }
          }
        }
      `,
      variables
    );

    return transactions.edges!.map(
      (edge) => new TransactionCoder('transaction').decode(arrayify(edge!.node!.rawPayload), 0)[0]
    );
  }

  async getBlock(blockId: string): Promise<GetBlockQuery['block'] | void> {
    const { block } = await graphqlFetch<GetBlockQuery, GetBlockQueryVariables>(
      this.url,
      gql`
        query getBlock($blockId: HexString256!) {
          block(id: $blockId) {
            id
            height
            producer
            transactions {
              id
              rawPayload
            }
            time
          }
        }
      `,
      { blockId }
    );

    if (!block) {
      return undefined;
    }

    return block;
  }

  async getBlocks(variables: GetBlocksQueryVariables): Promise<BlockFragmentFragment[]> {
    const { blocks } = await graphqlFetch<GetBlocksQuery, GetBlocksQueryVariables>(
      this.url,
      gql`
        query getBlocks($after: String, $before: String, $first: Int, $last: Int) {
          blocks(after: $after, before: $before, first: $first, last: $last) {
            edges {
              node {
                ...blockFragment
              }
            }
          }
        }
        ${blockFragment}
      `,
      variables
    );

    return blocks.edges!.map((edge) => edge!.node!);
  }

  async getCoin(coinId: string): Promise<GetCoinQuery['coin'] | void> {
    const { coin } = await graphqlFetch<GetCoinQuery, GetCoinQueryVariables>(
      this.url,
      gql`
        query getCoin($coinId: HexString256!) {
          coin(id: $coinId) {
            id
            owner
            amount
            color
            maturity
            status
            blockCreated
          }
        }
      `,
      { coinId }
    );

    if (!coin) {
      return undefined;
    }

    return coin;
  }

  async call(transactionRequest: TransactionRequest): Promise<TransactionResponse> {
    const transaction = transactionFromRequest(transactionRequest);

    return {
      receipts: await this.dryRun(transaction),
    };
  }

  async sendTransaction(transactionRequest: TransactionRequest): Promise<Transaction> {
    const transaction = transactionFromRequest(transactionRequest);

    const transactionId = await this.submit(transaction);

    const receivedTransaction = await this.getTransaction(transactionId);

    if (!receivedTransaction) {
      throw new Error('Transaction not found');
    }

    return receivedTransaction;
  }

  async dryRun(transaction: Transaction): Promise<Receipt[]> {
    const encodedTransaction = hexlify(new TransactionCoder('transaction').encode(transaction));
    const { dryRun: clientReceipts }: DryRunMutation = await graphqlFetch<
      DryRunMutation,
      DryRunMutationVariables
    >(
      this.url,
      gql`
        mutation ($encodedTransaction: HexString!) {
          dryRun(tx: $encodedTransaction) {
            rawPayload
          }
        }
      `,
      {
        encodedTransaction,
      }
    );

    const receipts = clientReceipts.map(
      (encodedReceipt) =>
        new ReceiptCoder('receipt').decode(arrayify(encodedReceipt.rawPayload), 0)[0]
    );

    return receipts;
  }

  async submit(transaction: Transaction): Promise<string> {
    const encodedTransaction = hexlify(new TransactionCoder('transaction').encode(transaction));
    const { submit: transactionId }: SubmitMutation = await graphqlFetch<
      SubmitMutation,
      SubmitMutationVariables
    >(
      this.url,
      gql`
        mutation submit($encodedTransaction: HexString!) {
          submit(tx: $encodedTransaction)
        }
      `,
      {
        encodedTransaction,
      }
    );

    return transactionId;
  }

  async startSession(): Promise<string> {
    const { startSession: sessionId } = await graphqlFetch<
      StartSessionMutation,
      StartSessionMutationVariables
    >(
      this.url,
      gql`
        mutation startSession {
          startSession
        }
      `
    );

    return sessionId;
  }

  async endSession(sessionId: string): Promise<boolean> {
    const { endSession } = await graphqlFetch<EndSessionMutation, EndSessionMutationVariables>(
      this.url,
      gql`
        mutation endSession($sessionId: ID!) {
          endSession(id: $sessionId)
        }
      `,
      { sessionId }
    );

    return endSession;
  }

  async execute(sessionId: string, op: string): Promise<boolean> {
    const { execute } = await graphqlFetch<ExecuteMutation, ExecuteMutationVariables>(
      this.url,
      gql`
        mutation execute($sessionId: ID!, $op: String!) {
          execute(id: $sessionId, op: $op)
        }
      `,
      { sessionId, op }
    );

    return execute;
  }

  async reset(sessionId: string): Promise<boolean> {
    const { reset } = await graphqlFetch<ResetMutation, ResetMutationVariables>(
      this.url,
      gql`
        mutation reset($sessionId: ID!) {
          reset(id: $sessionId)
        }
      `,
      { sessionId }
    );

    return reset;
  }
}
