import type { GetServerSideProps } from 'next'

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/operations', permanent: false },
})

export default function Index() {
  return null
}
