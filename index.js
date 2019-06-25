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
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Author {
    name: String!
    born: Int
    bookCount: Int!
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
    me: User!
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
    allBooks: (root, args) => {
      if (!args.author && !args.genre) {
        const theBooks = Book.find({}).populate('author')
        console.log(theBooks)
        return theBooks
      }

      // tää ei vielä toimi (kai?)
      if (args.author && !args.genre) {
        const newBooks = Book.find({ author: args.author })
        //const newBooks = allBook.filter(b => b.author === args.author)

        // alkuper
        //const newBooks = books.filter(b => b.author === args.author)
        return newBooks
      }

      if (!args.author && args.genre) {
        const newBooks = Book.find({ genres: { $in: [args.genre] } })
        //const newBooks = allBook.filter(b => b.genres.includes(args.genre))
        //const newBooks = books.filter(b => b.genres.includes(args.genre))
        return newBooks
      }

      // eikä tämä
      const newBooks = allBook.filter(b => b.author === args.author)
      // alkuper
      // const newBooks = books.filter(b => b.author === args.author)
      //const anotherBooks = newBooks.filter(b => b.genres.includes(args.genre))
      const anotherBooks = newBooks.find({ genres: { $in: [args.genre] } })
      return anotherBooks
      //return Book.find({})

    },
    allAuthors: () => {
      const authors = Author.find({})
      const books = Book.find({ author: Author.find({}) })
      // const output = books.reduce((bookList, line) => {
      //   bookList[line.author] = bookList[line.author] || []
      //   bookList[line.author].push(line.title)
      //   return bookList
      // }, {})

      // const newAuthors = authors.reduce((newAuthors, obj) => {
      //   newAuthors.push({...obj, bookCount: output[obj.name].length})
      //   return newAuthors
      // }, [])

      // return newAuthors
      return authors
    },
    me: async (root, args, context) => {
      // context.currentUser || 
      const blaa = await User.findOne({username: "paltu"})
      console.log(blaa)
      return blaa
    }
  },
  Author: {
    bookCount: async (wanted) => {
      const wantedNumber = await Book.collection.countDocuments({ author: wanted._id })
      return wantedNumber
    }
  },

  Mutation: {
    addBook: async (root, args, context) => {
      const currentUser = context.currentUser || true

      let authorFound = await Author.findOne({ name: args.author })
      // const authorFound = authors.find(author => author.name === book.author)

      if (!currentUser) {
        throw new AuthenticationError("not authenticated")
      }
      if (authorFound === null) {
        authorFound = new Author({
          name: args.author,
          born: null,
          bookCount: 1
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

        // await Book.findOne({ title: args.title }).populate('author')
        //   .exec((err, author) => {
        //     if (err) { console.log(err) }
        //     else { console.log(author) }
        //   })

        
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args
        })
      }
      console.log('book added at server!')
      pubsub.publish('BOOK_ADDED', { bookAdded: book })


      // if (books.find(b => b.title === args.title)) {
      //     throw new UserInputError('Title must be unique', {
      //       invalidArgs: args.title,
      //     })
      // }

      // const book = { ...args, id: uuid() }
      // books = books.concat(book)



      // if (authorFound === undefined) {
      //     const newAuthor = {
      //         name: book.author,
      //         born: null,
      //         bookCount: 1
      //     }
      //     authors = authors.concat(newAuthor)
      // }

      // return book
      return book
    },

    editAuthor: async (root, args, context) => {
      const currentUser = context.currentUser
      console.log(context)
      const author = await Author.findOne({ name: args.name })
      console.log(author)
      if (!currentUser) {
        throw new AuthenticationError("not authenticated", {
          invalidArgs: args
        })
      }
      // alkuper
      //const author = authors.find(author => author.name === args.name)
      // if (author === undefined)
      if (!author) {
        return null
      }

      // alkuper
      //const modifiedAuthor = { ...author, born: args.setBornTo }
      author.born = args.setBornTo

      //authors = authors.filter(a => a.id !== author.id)
      //authors = authors.concat(modifiedAuthor)
      try {
        await author.save()
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
      return author
      //return modifiedAuthor
    },
    createUser: (root, args) => {
      const user = new User({ username: args.username  })

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