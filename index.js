const { ApolloServer, UserInputError, AuthenticationError, gql } = require('apollo-server')
const uuid = require('uuid/v1')

const mongoose = require('mongoose')
const Author = require('./models/author')
const Book = require('./models/book')
const User = require('./models/user')

const { PubSub } = require('apollo-server')
const pubsub = new PubSub()

const jwt = require('jsonwebtoken')
const config = require('./config')

mongoose.set('useFindAndModify', false)

console.log('connecting to', config.MONGODB_URI)


mongoose.connect(config.MONGODB_URI, { useNewUrlParser: true })
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connection to MongoDB:', error.message)
  })


const typeDefs = gql`
  type User {
    username: String!
    favoriteGenre: String
    id: ID!
  }

  type Token {
    value: String!
  }

  type Author {
    name: String!
    born: Int
    bookCount: [Book!]!
    id: ID!
  }

  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!
    id: ID!
  }

  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks (author: String genre: String): [Book!]!
    allAuthors: [Author]
    me: User
  }

  type Mutation {
    createUser(
      username: String!
      favoriteGenre: String!
    ): User

    login(
      username: String!
      password: String!
    ): Token

    addBook(
        title: String!
        author: String!
        published: Int!
        genres: [String]
    ): Book,

    editAuthor(
        name: String!
        setBornTo: Int!
    ): Author
  }

  type Subscription {
    bookAdded: Book!
  }
`

const resolvers = {
  Query: {
    bookCount: () => Book.collection.countDocuments(),
    authorCount: () => Author.collection.countDocuments(),
    allBooks: async (root, args) => {
      if (!args.author && !args.genre) {
        const theBooks = await Book.find({}).populate('author')
        return theBooks
      }

      if (args.author && !args.genre) {
        const newBooks = await Book.find().populate('author')
        const filteredBooks = newBooks.filter(book => book.author.name === args.author)
        return filteredBooks
      }

      if (!args.author && args.genre) {
        const newBooks = await Book.find({ genres: { $in: [args.genre] } })
        return newBooks
      }

      const newBooks = await Book.find().populate('author')
      const filteredBooks = newBooks.filter(book => book.author.name === args.author)
      const anotherBooks = filteredBooks.find({ genres: { $in: [args.genre] } })
      return anotherBooks

    },
    allAuthors: () => {
      console.log('Author.find')
      const authors = Author.find({}).populate('bookCount')
      return authors
    },
    me: async (root, args, context) => {
      return await context.currentUser
    }
  },

  Mutation: {
    addBook: async (root, args, context) => {
      const currentUsr = context.currentUser

      let authorFound = await Author.findOne({ name: args.author })

      if (!currentUsr) {
        throw new AuthenticationError("not authenticated")
      }
      if (authorFound === null) {
        authorFound = new Author({
          name: args.author,
          born: null,
          bookCount: []
        })
        await authorFound.save()
      }

      const book = new Book({
        title: args.title,
        author: authorFound._id,
        published: args.published,
        genres: args.genres
      }).populate('author')

      try {
        await book.save()
        authorFound.bookCount.push(book._id)
        await authorFound.populate('bookCount')
        await authorFound.save()

        
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args
        })
      }
      console.log('book added at server!')
      pubsub.publish('BOOK_ADDED', { bookAdded: book })

      return book
    },

    editAuthor: async (root, args, context) => {
      const currentUsr = context.currentUser
      console.log('edit author', currentUsr)
      const author = await Author.findOne({ name: args.name })
      if (!currentUsr) {
        throw new AuthenticationError("not authenticated", {
          invalidArgs: args
        })
      }

      if (!author) {
        return null
      }

      author.born = args.setBornTo

      try {
        await author.save()
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
      return author
    },
    createUser: (root, args) => {
      const user = new User({ username: args.username, favoriteGenre: args.favoriteGenre })

      return user.save()
        .catch(error => {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        })
    },
    login: async (root, args) => {
      const user = await User.findOne({ username: args.username })

      if (!user || args.password !== 'secretpass') {
        throw new UserInputError("wrong credentials")
      }

      const userForToken = {
        username: user.username,
        id: user._id,
      }
      console.log(userForToken)

      return { value: jwt.sign(userForToken, config.JWT_SECRET) }
    }
  },

  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED'])
    },
  }

}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ request }) => {
    const auth = request ? request.headers.authorization : null
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      console.log('authorized')
      const decodedToken = jwt.verify(
        auth.substring(7), config.JWT_SECRET
      )
      const currentUser = await User.findById(decodedToken.id)
      return { currentUser }
    }
  }
})

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`)
  console.log(`Subscriptions ready at ${subscriptionsUrl}`)
})